"""Static scene radiance on real geometry, with a bounded directional glossy cache.

The source materials remain in place until every transport pass is finished.
No display transform, web lights, or procedural clay are baked twice. This is
an approximation for a declared camera domain, not a universal Cycles player.
"""
import hashlib
import json
import math
import struct
import time
from pathlib import Path

from bake import UV_NAME, atlas_groups, unwrap_objects, pad_bake_images, save_denoised
from hybrid import bake_log, encode_rgbm, write_png

VERSION = 1


def preflight(scene):
    """Fail closed on features this static surface representation cannot preserve."""
    import bpy
    errors, warnings = [], []
    if tuple(bpy.data.version[:2]) > tuple(bpy.app.version[:2]):
        errors.append('The source uses a newer Blender version; select a matching worker before conversion.')
    if scene.render.engine != 'CYCLES':
        errors.append('Use a Cycles scene; renderer substitution is not supported.')
    if not scene.camera or scene.camera.data.type not in {'PERSP', 'ORTHO'}:
        errors.append('An active perspective or orthographic camera is required.')
    if scene.render.film_transparent:
        errors.append('Transparent film is not supported; use an opaque world/background.')
    for obj in scene.objects:
        if obj.hide_render:
            continue
        if obj.type in {'VOLUME', 'HAIR', 'POINTCLOUD', 'META'}:
            errors.append('Unsupported geometry: ' + obj.name + ' (' + obj.type + ')')
        if getattr(obj,'is_shadow_catcher',False) or getattr(obj,'is_holdout',False):
            errors.append('Shadow catcher/holdout requires compositing: ' + obj.name)
        if obj.type=='MESH' and not getattr(obj,'visible_camera',True):
            errors.append('Camera-invisible geometry needs an explicit transport-only export role: '+obj.name)
        if obj.instance_type != 'NONE' or any(m.type in {'PARTICLE_SYSTEM', 'NODES'} for m in obj.modifiers):
            errors.append('Realize procedural instances before export: ' + obj.name)
        if obj.animation_data:
            warnings.append('Current frame frozen: ' + obj.name)
    seen = set()
    def nodes(tree):
        if not tree or tree in seen:
            return
        seen.add(tree)
        for node in tree.nodes:
            if node.type == 'GROUP':
                nodes(node.node_tree)
            if node.type in {'VOLUME_ABSORPTION', 'VOLUME_SCATTER', 'PRINCIPLED_VOLUME', 'HOLDOUT'}:
                errors.append('Unsupported shader: ' + tree.name + '/' + node.name)
            if node.type in {'BSDF_GLASS', 'BSDF_REFRACTION', 'BSDF_TRANSPARENT'}:
                warnings.append('Directional approximation of transmission/opacity: ' + tree.name)
    for mat in {m for o in scene.objects if o.type in {'MESH', 'CURVE', 'FONT', 'SURFACE'} for m in o.data.materials if m}:
        nodes(mat.node_tree)
        if mat.use_nodes:
            for node in mat.node_tree.nodes:
                if node.type == 'BSDF_PRINCIPLED':
                    for name in ('Transmission', 'Transmission Weight', 'Alpha'):
                        socket = node.inputs.get(name)
                        if socket and (socket.is_linked or (socket.default_value < .99 if name == 'Alpha' else socket.default_value > .01)):
                            warnings.append('Directional approximation of transmission/opacity: ' + mat.name)
    nodes(scene.world.node_tree if scene.world else None)
    if scene.use_nodes and scene.node_tree:
        allowed = {'R_LAYERS', 'COMPOSITE', 'VIEWER', 'DENOISE', 'OUTPUT_FILE', 'REROUTE', 'FRAME'}
        for node in scene.node_tree.nodes:
            if not node.mute and node.type not in allowed:
                errors.append('Compositor effect requires a web implementation: ' + node.name)
    return {'schema': VERSION, 'errors': sorted(set(errors)), 'warnings': sorted(set(warnings)),
            'supported': not errors, 'frame': scene.frame_current,
            'contract': 'static Cycles surfaces; bounded camera; directional reflection/transmission approximation'}


def scene_bounds(objects):
    from mathutils import Vector
    points = [o.matrix_world @ Vector(c) for o in objects for c in o.bound_box]
    return (Vector(tuple(min(p[k] for p in points) for k in range(3))),
            Vector(tuple(max(p[k] for p in points) for k in range(3))))


def camera_domain(scene, objects):
    from mathutils import Vector
    low, high = scene_bounds(objects)
    center = (low + high) * .5
    camera = scene.camera
    forward = camera.matrix_world.to_quaternion() @ Vector((0, 0, -1))
    distance = max((center - camera.location).dot(forward), (high-low).length)
    target = camera.location + forward * distance
    out = -forward
    azimuth = math.atan2(out.x, -out.y)
    elevation = math.asin(out.z)
    # The public rig never orbits. The azimuth interval covers perspective rays.
    return {'azimuth': azimuth, 'elevation': elevation,
            'azimuthRange': [azimuth-math.radians(30), azimuth+math.radians(30)],
            'elevationRange': [max(.08, elevation-math.radians(24)), min(1.48, elevation+math.radians(18))],
            'tilt': math.radians(10), 'pan': .22, 'zoomMax': 2.2,
            'span': max(high.x-low.x, high.y-low.y, 1), 'distance': distance,
            'target': [target.x, target.z, -target.y], 'projection': camera.data.type}


def render_views(scene, output, domain, samples=64):
    import bpy
    from mathutils import Vector
    from render import web_scene
    camera = scene.camera
    matrix, data = camera.matrix_world.copy(), camera.data.copy()
    settings = (scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage,
                scene.render.filepath, scene.cycles.samples)
    target = Vector((domain['target'][0], -domain['target'][2], domain['target'][1]))
    right = matrix.to_quaternion() @ Vector((1, 0, 0))
    across = Vector((-right.y, right.x, 0))
    # Includes held-out positions/elevations, not just the baked sample directions.
    poses = [('authored', 0, 0, 0), ('left', -.18, 0, .35), ('right', .18, 0, .35),
             ('near', 0, 0, 1), ('low', .10, .08, .75), ('heldout', -.07, -.06, .57)]
    views = []
    try:
        for name, x, y, zoom in poses:
            camera.matrix_world = matrix.copy()
            if zoom or x or y:
                focus = target + (right*x + across*y)*domain['span']
                elevation = domain['elevation'] - domain['tilt']*zoom
                azimuth = domain['azimuth']
                direction = Vector((math.sin(azimuth)*math.cos(elevation), -math.cos(azimuth)*math.cos(elevation), math.sin(elevation)))
                camera.location = focus + direction*domain['distance']*(1-.08*zoom)
                camera.rotation_euler = (-direction).to_track_quat('-Z','Y').to_euler()
            camera.data.ortho_scale = data.ortho_scale/(1+(domain['zoomMax']-1)*zoom)
            camera.data.lens = data.lens*(1+(domain['zoomMax']-1)*zoom)
            scene.render.resolution_x, scene.render.resolution_y = settings[:2]
            scene.render.resolution_percentage = max(1, int(100*min(1, 1000/max(settings[:2]))))
            scene.cycles.samples = samples
            scene.cycles.use_denoising = True
            scene.render.image_settings.file_format = 'PNG'
            scene.render.filepath = str(output / ('reference-'+name+'.png'))
            bpy.context.view_layer.update()
            with bake_log():
                bpy.ops.render.render(write_still=True)
            views.append({'id': name, 'reference': 'reference-'+name+'.png', 'camera': web_scene(scene)['camera'],
                          'width': int(scene.render.resolution_x*scene.render.resolution_percentage/100),
                          'height': int(scene.render.resolution_y*scene.render.resolution_percentage/100),
                          'pan': [x, y], 'zoom': zoom})
            print('RADIANCE_REFERENCE', name, flush=True)
    finally:
        camera.matrix_world = matrix
        camera.data.ortho_scale, camera.data.lens = data.ortho_scale, data.lens
        bpy.data.cameras.remove(data)
        scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage, scene.render.filepath, scene.cycles.samples = settings
        bpy.context.view_layer.update()
    (output/'views.json').write_text(json.dumps({'schema': VERSION, 'domain': domain, 'views': views}, indent=2))
    return views


def make_lut(scene, output, size=64):
    """Sample the actual source OCIO pipeline, including its look/exposure/gamma."""
    import bpy
    import numpy as np
    image = bpy.data.images.new('Source display transform', size*size, size, float_buffer=True, alpha=True)
    r = np.tile(np.arange(size), size)[None, :]
    b = np.repeat(np.arange(size), size)[None, :]
    g = np.arange(size)[:, None]
    pixels = np.ones((size, size*size, 4), dtype=np.float32)
    for k, channel in enumerate((r,g,b)):
        pixels[:,:,k] = (np.exp2(channel/(size-1)*16)-1)/16
    image.pixels.foreach_set(pixels.ravel())
    path = output/'radiance-display.png'
    fmt = scene.render.image_settings
    old = fmt.file_format, fmt.color_mode, fmt.color_depth
    fmt.file_format, fmt.color_mode, fmt.color_depth = 'PNG', 'RGBA', '8'
    image.save_render(str(path), scene=scene)
    fmt.file_format, fmt.color_mode, fmt.color_depth = old
    bpy.data.images.remove(image)
    return {'path': path, 'size': size, 'shaper': 'log2(1+16*x)/16', 'origin': 'bottom-left'}


def embed(path, material_maps, metadata, lut):
    binary = path.read_bytes()
    length = struct.unpack_from('<I', binary, 12)[0]
    doc = json.loads(binary[20:20+length])
    blob = bytearray(binary[28+length:])
    cache = {}
    def texture(file):
        file = Path(file)
        if file in cache:
            return cache[file]
        blob.extend(b'\0'*(-len(blob)%4))
        data = file.read_bytes()
        view = len(doc.setdefault('bufferViews', []))
        doc['bufferViews'].append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data)})
        blob.extend(data)
        image = len(doc.setdefault('images', []))
        doc['images'].append({'bufferView': view, 'mimeType': 'image/png'})
        index = len(doc.setdefault('textures', []))
        doc['textures'].append({'source': image})
        cache[file] = index
        return index
    for material in doc.get('materials', []):
        maps = material_maps.get(material.get('name'))
        if maps:
            material.setdefault('extras', {})['studioRadiance'] = {
                'schema': VERSION, 'diffuse': {'texture': texture(maps['diffuse']['path']), 'range': maps['diffuse']['range']},
                'views': [{'texture': texture(v['path']), 'range': v['range']} for v in maps['views']]}
    metadata = {**metadata, 'display': {k:v for k,v in lut.items() if k != 'path'}, 'displayTexture': texture(lut['path'])}
    doc.setdefault('extras', {})['studioRadiance'] = metadata
    doc['buffers'][0]['byteLength'] = len(blob)
    encoded = json.dumps(doc,separators=(',',':')).encode()
    encoded += b' '*(-len(encoded)%4)
    blob.extend(b'\0'*(-len(blob)%4))
    path.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(encoded)+len(blob))+struct.pack('<I4s',len(encoded),b'JSON')+encoded+struct.pack('<I4s',len(blob),b'BIN\0')+blob)


def bake_scene(scene, output, quality, whole_space=False, resolution_override=None, samples_override=None):
    import bpy
    import numpy as np
    from mathutils import Vector
    from render import web_scene
    start = time.monotonic()
    audit = preflight(scene)
    (output/'compatibility.json').write_text(json.dumps(audit, indent=2))
    if audit['errors']:
        raise ValueError('\n'.join(audit['errors']))
    meshes = [o for o in scene.objects if o.type in {'MESH','CURVE','FONT','SURFACE'} and not o.hide_render and o.visible_get()]
    if not meshes or len(meshes)>12000:
        raise ValueError('Radiance baking requires 1–12000 visible surfaces')
    deps = bpy.context.evaluated_depsgraph_get()
    evaluated = [(o,bpy.data.meshes.new_from_object(o.evaluated_get(deps),preserve_all_data_layers=True,depsgraph=deps)) for o in meshes]
    triangles = sum(sum(len(p.vertices)-2 for p in mesh.polygons) for _,mesh in evaluated)
    if triangles>3_000_000:
        raise ValueError('Radiance baking exceeds the 3-million-triangle limit')
    for obj, mesh in evaluated:
        if obj.type != 'MESH':
            copy = bpy.data.objects.new(obj.name+' mesh',mesh)
            scene.collection.objects.link(copy)
            copy.matrix_world = obj.matrix_world.copy()
            obj.hide_render = True
            meshes[meshes.index(obj)] = copy
            obj = copy
        else:
            obj.data = mesh
        obj.modifiers.clear()
        obj.hide_select = False
        if not obj.data.materials:
            mat = bpy.data.materials.new('Default surface')
            mat.diffuse_color = (.8,.8,.8,1)
            obj.data.materials.append(mat)
    largest = max(meshes,key=lambda o:o.dimensions.x*o.dimensions.y)
    other = [o for o in meshes if o!=largest]
    low,high = scene_bounds(other or meshes)
    span = max(high.x-low.x,high.y-low.y,1)
    backdrop = largest if largest.get('studioBackdrop') or (largest.dimensions.z<span*.04 and min(largest.dimensions.x,largest.dimensions.y)>span*3) else None
    if backdrop:
        backdrop['studioBackdrop'] = True
    domain = camera_domain(scene, [o for o in meshes if o!=backdrop] or meshes)
    source = web_scene(scene)
    render_views(scene, output, domain, samples=16 if resolution_override else 64)
    lut = make_lut(scene, output)
    # Preserve full geometry for all bounce/occlusion paths. No source backfaces are removed.
    groups = atlas_groups([o for o in meshes if o!=backdrop], whole_space, quality)
    if backdrop:
        groups.append(('backdrop',[backdrop],2048))
    samples = samples_override or (128 if quality=='preview' else 512)
    scene.cycles.use_denoising = False
    scene.render.bake.use_selected_to_active = False
    scene.render.bake.use_clear = True
    scene.render.bake.view_from = 'ACTIVE_CAMERA'
    scene.render.bake.margin_type = 'EXTEND'
    source_matrix = scene.camera.matrix_world.copy()
    source_type = scene.camera.data.type
    maps, replacements, atlases = {}, [], []
    cursor = 0
    while cursor < len(groups):
        name, objects, _ = groups[cursor]
        cursor += 1
        resolution = resolution_override or (2048 if name=='backdrop' else 1024 if quality=='preview' else 2048)
        if len(objects)>96 or (sum(len(o.data.polygons) for o in objects)>50000 and len(objects)>1):
            mid = len(objects)//2
            groups[cursor:cursor] = [(name+'_p0',objects[:mid],resolution),(name+'_p1',objects[mid:],resolution)]
            continue
        bpy.ops.object.select_all(action='DESELECT')
        clones = {}
        def new_image(label, size):
            image = bpy.data.images.new(label,size,size,alpha=True,float_buffer=True)
            image.generated_color = (0,0,0,0)
            image.colorspace_settings.name = 'Non-Color'
            return image
        target = new_image(name,resolution)
        for obj in objects:
            old_uv = obj.data.uv_layers.active.name if obj.data.uv_layers.active else ''
            layer = obj.data.uv_layers.get(UV_NAME) or obj.data.uv_layers.new(name=UV_NAME)
            obj.data.uv_layers.active = layer
            if old_uv:
                obj.data.uv_layers[old_uv].active_render = True
            for i,mat in enumerate(list(obj.data.materials)):
                if not mat:
                    raise ValueError('Missing material: '+obj.name)
                key = (mat.name,old_uv)
                if key not in clones:
                    copy = mat.copy()
                    if not copy.use_nodes:
                        color = tuple(copy.diffuse_color)
                        copy.use_nodes = True
                        copy.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = color
                    node = copy.node_tree.nodes.new('ShaderNodeTexImage')
                    node.image = target
                    copy.node_tree.nodes.active = node
                    clones[key] = copy
                obj.data.materials[i] = clones[key]
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        try:
            if name == 'backdrop':
                # Crop the UV domain, never the geometry used by light transport.
                radius = max(domain['span']*1.5, scene.camera.data.ortho_scale if source_type=='ORTHO' else domain['span']*2)
                center = (low+high)*.5
                for obj in objects:
                    uv = obj.data.uv_layers[UV_NAME].data
                    for loop in obj.data.loops:
                        p = obj.matrix_world @ obj.data.vertices[loop.vertex_index].co
                        uv[loop.index].uv = ((p.x-center.x)/(2*radius)+.5,(p.y-center.y)/(2*radius)+.5)
            else:
                unwrap_objects(objects,resolution,'_detail' in name,padding=8,minimum=4)
        except ValueError:
            bpy.data.images.remove(target)
            if len(objects)<2:
                raise
            mid = len(objects)//2
            groups[cursor:cursor] = [(name+'_p0',objects[:mid],resolution),(name+'_p1',objects[mid:],resolution)]
            continue
        def bake(image, passes):
            for mat in clones.values():
                mat.node_tree.nodes.active.image = image
            scene.cycles.samples = samples
            with bake_log():
                bpy.ops.object.bake(type='COMBINED',pass_filter=passes,uv_layer=UV_NAME,margin=0)
        def save(image, suffix, albedo=None, normal=None):
            size = image.size[0]
            values = np.empty(size*size*4,dtype=np.float32)
            image.pixels.foreach_get(values)
            coverage = values.reshape(size,size,4)[:,:,3]>.5
            if not coverage.any():
                raise ValueError('Empty radiance atlas: '+name)
            path = output/(name+'_'+suffix+'.png')
            linear = output/(name+'_'+suffix+'.exr')
            with bake_log():
                save_denoised(image,linear,scene,albedo=albedo,normal=normal,linear=True)
            clean = bpy.data.images.load(str(linear),check_existing=False)
            clean.colorspace_settings.name = 'Non-Color'
            clean.pixels.foreach_get(values)
            rgba = values.reshape(size,size,4)
            rgba[:,:,3] = coverage
            clean.pixels.foreach_set(values)
            pad_bake_images([clean],radius=6,coverage=coverage)
            clean.pixels.foreach_get(values)
            encoded, scale = encode_rgbm(values.reshape(size,size,4))
            write_png(path,encoded)
            bpy.data.images.remove(clean)
            linear.unlink()
            atlases.append({'name':path.name,'width':size,'height':size,'kind':suffix,'objects':len(objects)})
            return {'path':path,'range':scale}
        print('RADIANCE_DIFFUSE',name,len(objects),resolution,flush=True)
        scene.camera.matrix_world = source_matrix.copy()
        bake(target,{'COLOR','DIRECT','INDIRECT','DIFFUSE','EMIT'})
        guides=[]
        for kind in ('DIFFUSE','NORMAL'):
            guide=new_image(name+' guide '+kind,resolution)
            for mat in clones.values():mat.node_tree.nodes.active.image=guide
            scene.cycles.samples=1
            with bake_log():
                if kind=='DIFFUSE':bpy.ops.object.bake(type=kind,pass_filter={'COLOR'},uv_layer=UV_NAME,margin=0)
                else:bpy.ops.object.bake(type=kind,normal_space='OBJECT',uv_layer=UV_NAME,margin=0)
            guides.append(guide)
        normal_pixels=np.empty(resolution*resolution*4,dtype=np.float32)
        guides[1].pixels.foreach_get(normal_pixels)
        normal_pixels.reshape(-1,4)[:,:3]=normal_pixels.reshape(-1,4)[:,:3]*2-1
        guides[1].pixels.foreach_set(normal_pixels)
        diffuse = save(target,'diffuse',*guides)
        for guide in guides:bpy.data.images.remove(guide)
        bpy.data.images.remove(target)
        views = []
        size = resolution_override or min(resolution,512 if quality=='preview' else 1024)
        glossy = new_image(name+' glossy',size)
        for e in range(3):
            for a in range(3):
                az = domain['azimuthRange'][0]+a/2*(domain['azimuthRange'][1]-domain['azimuthRange'][0])
                el = domain['elevationRange'][0]+e/2*(domain['elevationRange'][1]-domain['elevationRange'][0])
                direction = Vector((math.sin(az)*math.cos(el),-math.cos(az)*math.cos(el),math.sin(el)))
                # Bake rays are effectively parallel. Runtime evaluates directions per fragment.
                scene.camera.data.type = 'PERSP'
                scene.camera.location = (low+high)*.5+direction*domain['span']*10000
                scene.camera.rotation_euler = (-direction).to_track_quat('-Z','Y').to_euler()
                bpy.context.view_layer.update()
                bake(glossy,{'COLOR','DIRECT','INDIRECT','GLOSSY','TRANSMISSION'})
                views.append(save(glossy,'view'+str(e*3+a)))
                print('RADIANCE_VIEW',name,e*3+a,flush=True)
        bpy.data.images.remove(glossy)
        scene.camera.matrix_world = source_matrix.copy()
        scene.camera.data.type = source_type
        mat = bpy.data.materials.new('Radiance '+name)
        mat.use_nodes = True
        mat.node_tree.nodes.clear()
        emit = mat.node_tree.nodes.new('ShaderNodeEmission')
        out = mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
        mat.node_tree.links.new(emit.outputs[0],out.inputs['Surface'])
        maps[mat.name] = {'diffuse':diffuse,'views':views}
        replacements.append((objects,mat))
    for objects,mat in replacements:
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.data.materials.clear()
            obj.data.materials.append(mat)
            for poly in obj.data.polygons:
                poly.material_index = 0
            for name in [layer.name for layer in obj.data.uv_layers]:
                if name != UV_NAME:
                    obj.data.uv_layers.remove(obj.data.uv_layers[name])
            obj['studioRadiance'] = True
            obj.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        if len(objects)>1:
            bpy.ops.object.join()
    scene.camera.matrix_world = source_matrix.copy()
    scene.camera.data.type = source_type
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    meshes=[o for o in scene.objects if o.type=='MESH' and not o.hide_render and o.visible_get()]
    for obj in meshes+[scene.camera]:
        obj.select_set(True)
    path = output/'baked.glb'
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,use_active_scene=True,export_cameras=True,
                             export_lights=False,export_extras=True,export_animations=False,export_materials='EXPORT')
    embed(path,maps,{'schema':VERSION,'domain':domain,'lighting':source,'grid':[3,3],
                    'warnings':audit['warnings'],'static':True},lut)
    data = path.read_bytes()
    if len(data)>48*1024**2:
        raise ValueError('Radiance GLB exceeds 48 MiB; split the scene or reduce atlas resolution.')
    return {'schema':1,'radianceVersion':VERSION,'bakerVersion':8,'file':'baked.glb','bytes':len(data),
            'sha256':hashlib.sha256(data).hexdigest(),'samples':samples,'triangles':triangles,'atlases':atlases,
            'compatibility':audit,'domain':domain,'directionSamples':9,'seconds':round(time.monotonic()-start,2),
            'limitations':['Static current frame','3x3 directional approximation; sharp reflections/transmission require denser sampling',
                           'No volumes or arbitrary compositor effects','Camera must remain inside declared domain']}
