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


def uncovered_surfaces(objects, image):
    import numpy as np
    pixels=np.empty(image.size[0]*image.size[1]*4,dtype=np.float32)
    image.pixels.foreach_get(pixels)
    coverage=pixels.reshape(image.size[1],image.size[0],4)[:,:,3]>.5
    pad_bake_images([image],radius=3,coverage=coverage)
    image.pixels.foreach_get(pixels)
    mask=pixels.reshape(image.size[1],image.size[0],4)[:,:,3]>.5
    missing=[]
    for obj in objects:
        obj.data.calc_loop_triangles();uv=obj.data.uv_layers[UV_NAME].data
        total=sum(t.area for t in obj.data.loop_triangles);lost=0
        for triangle in obj.data.loop_triangles:
            point=sum((uv[i].uv for i in triangle.loops),uv[triangle.loops[0]].uv*0)/3
            x=min(image.size[0]-1,max(0,int(point.x*image.size[0])));y=min(image.size[1]-1,max(0,int(point.y*image.size[1])))
            if not mask[y,x]:lost+=triangle.area
        if lost>max(total*.002,1e-12):missing.append(obj.name)
    return missing


def dense_reflections(objects):
    """Use extra elevation samples for transparent or sharp reflective surfaces."""
    seen=set()
    def inspect(tree):
        if not tree or tree in seen:return False
        seen.add(tree)
        for node in tree.nodes:
            if node.type=='GROUP' and inspect(node.node_tree):return True
            if node.type in {'BSDF_GLASS','BSDF_REFRACTION','BSDF_TRANSPARENT'}:return True
            if node.type in {'BSDF_GLOSSY','BSDF_PRINCIPLED'}:
                rough=node.inputs.get('Roughness')
                if rough and (rough.is_linked or rough.default_value<.25):return True
            if node.type=='BSDF_PRINCIPLED':
                for name in ('Transmission','Transmission Weight','Alpha'):
                    socket=node.inputs.get(name)
                    if socket and (socket.is_linked or (socket.default_value<.99 if name=='Alpha' else socket.default_value>.01)):return True
        return False
    return any(inspect(m.node_tree) for obj in objects for m in obj.data.materials if m and m.use_nodes)


def read_reuse(root, domain, grid, repaired):
    """Verify source identity in render.py and world geometry/UVs here.

    Joined exports and individual meshes share the same canonical surface key.
    Direction samples are reused by angle, never merely by array index.
    """
    import numpy as np
    from mathutils import Matrix,Quaternion
    data=(root/'baked.glb').read_bytes();report=json.loads((root/'report.json').read_text())
    if hashlib.sha256(data).hexdigest()!=report['bake']['sha256']:raise ValueError('Reuse GLB checksum mismatch')
    n=struct.unpack_from('<I',data,12)[0];doc=json.loads(data[20:20+n]);blob=data[28+n:]
    profile=doc['extras']['studioRadiance'];old=profile['domain']
    same_domain=all(old[k]==domain[k] for k in ('azimuthRange','elevationRange'))
    prior_repairs=set(report['bake'].get('normalRepairs',[]))
    def accessor(index):
        a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']];width={'VEC2':2,'VEC3':3}[a['type']]
        return np.ndarray((a['count'],width),dtype='<f4',buffer=blob,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',width*4),4))
    geometry={}
    def visit(index,parent):
        node=doc['nodes'][index]
        if 'matrix' in node:local=Matrix(np.array(node['matrix']).reshape(4,4).T.tolist())
        else:
            q=node.get('rotation',[0,0,0,1]);local=Matrix.Translation(node.get('translation',[0,0,0]))@Quaternion((q[3],*q[:3])).to_matrix().to_4x4()@Matrix.Diagonal((*node.get('scale',[1,1,1]),1))
        matrix=parent@local;m=np.array(matrix)
        for primitive in doc['meshes'][node['mesh']]['primitives'] if 'mesh' in node else []:
            attrs=primitive['attributes'];points=np.einsum('ij,kj->ik',accessor(attrs['POSITION']),m[:3,:3])+m[:3,3];uv=accessor(attrs['TEXCOORD_0'])
            material=doc['materials'][primitive['material']]['name']
            geometry.setdefault(material,[]).append(np.concatenate([points,uv],axis=1))
        for child in node.get('children',[]):visit(child,matrix)
    for index in doc['scenes'][doc.get('scene',0)]['nodes']:visit(index,Matrix.Identity(4))
    def canonical(rows):
        # Source hash is already exact; tolerate only export float precision.
        rows=np.array(rows,dtype=np.float32);rows[:,:3]=np.round(rows[:,:3],4);rows[:,3:]=np.round(rows[:,3:],5)
        # UVs identify packed surface vertices. Sorting by world position first
        # can permute equal-position seam vertices after glTF float rounding.
        return np.unique(rows[:,[3,4,0,1,2]],axis=0)
    geometry={name:canonical(np.concatenate(parts)) for name,parts in geometry.items()}
    materials={m['name']:m.get('extras',{}).get('studioRadiance') for m in doc['materials']}
    def reuse(name,objects,output,desired):
        if any(obj.name in repaired-prior_repairs for obj in objects):return None
        info=materials.get('Radiance '+name)
        if not info:return None
        pairs=[]
        for obj in objects:
            uv=obj.data.uv_layers[UV_NAME].data
            for loop in obj.data.loops:
                p=obj.matrix_world@obj.data.vertices[loop.vertex_index].co;t=uv[loop.index].uv
                pairs.append((p.x,p.z,-p.y,t.x,1-t.y))
        current=canonical(pairs);previous=geometry.get('Radiance '+name)
        if previous is None or current.shape!=previous.shape or not np.allclose(current,previous,rtol=0,atol=2e-4):
            print('RADIANCE_REUSE_UV_MISMATCH',name,flush=True);return None
        def extract(suffix,item,old_suffix):
            image=doc['images'][doc['textures'][item['texture']]['source']];view=doc['bufferViews'][image['bufferView']]
            encoded=blob[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]
            path=output/(name+'_'+suffix+'.png');path.write_bytes(encoded)
            entry=next(a for a in report['bake']['atlases'] if a['name']==name+'_'+old_suffix+'.png')
            return {'path':path,'range':item['range'],'entry':{**entry,'name':path.name,'kind':suffix}}
        diffuse=extract('diffuse',info['diffuse'],'diffuse');views=[];old_grid=info.get('grid',profile['grid'])
        for e in range(desired[1]):
            for a in range(desired[0]):
                old_e=e/(desired[1]-1)*(old_grid[1]-1)
                old_a=0 if desired[0]==1 else a/(desired[0]-1)*(old_grid[0]-1)
                exact=same_domain and old_grid[0]==desired[0] and abs(old_e-round(old_e))<1e-8 and abs(old_a-round(old_a))<1e-8
                index=round(old_e)*old_grid[0]+round(old_a)
                views.append(extract('view'+str(len(views)),info['views'][index],'view'+str(index)) if exact else None)
        return {'diffuse':diffuse,'views':views,'grid':desired},[diffuse['entry']]
    return reuse


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
    if scene.camera and scene.camera.data.dof.use_dof:
        errors.append('Depth of field requires a matching web lens implementation; disable it for this export.')
    if scene.render.use_motion_blur:
        errors.append('Motion blur is not supported by a static surface cache.')
    for obj in scene.objects:
        if obj.hide_render:
            continue
        if obj.type in {'MESH','CURVE','FONT','SURFACE'} and not obj.visible_get():
            errors.append('Make render surfaces visible in the active view layer before export: '+obj.name)
        if obj.type in {'VOLUME', 'HAIR', 'POINTCLOUD', 'META'}:
            errors.append('Unsupported geometry: ' + obj.name + ' (' + obj.type + ')')
        if obj.type in {'MESH','CURVE','FONT','SURFACE'} and (getattr(obj,'is_shadow_catcher',False) or getattr(obj,'is_holdout',False)):
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
            if getattr(mat.cycles,'displacement_method','BUMP')!='BUMP' and any(n.type=='OUTPUT_MATERIAL' and n.inputs['Displacement'].is_linked for n in mat.node_tree.nodes):
                errors.append('Convert render-time displacement into mesh geometry before export: '+mat.name)
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
    up = camera.matrix_world.to_quaternion() @ Vector((0,1,0))
    # The public rig never orbits. The azimuth interval covers perspective rays.
    domain = {'azimuth': azimuth, 'elevation': elevation,
            'azimuthRange': [azimuth-math.radians(30), azimuth+math.radians(30)],
            'elevationRange': [max(-1.56, elevation-math.radians(24)), min(1.56, elevation+math.radians(18))],
            'tilt': min(math.radians(10),max(0,elevation-.08)), 'pan': .22, 'zoomMax': 2.2,
            'span': max(high.x-low.x, high.y-low.y, 1), 'distance': distance,
            'target': [target.x, target.z, -target.y], 'up':[up.x,up.z,-up.y], 'projection': camera.data.type}
    if camera.data.type=='ORTHO':
        domain['elevationRange']=[elevation-max(domain['tilt'],.01),elevation]
    return domain


def render_views(scene, output, domain, samples=64):
    import bpy
    from mathutils import Vector,Matrix
    from render import web_scene
    camera = scene.camera
    matrix, data = camera.matrix_world.copy(), camera.data.copy()
    settings = (scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage,
                scene.render.filepath, scene.cycles.samples)
    target = Vector((domain['target'][0], -domain['target'][2], domain['target'][1]))
    right = matrix.to_quaternion() @ Vector((1, 0, 0))
    source_up = matrix.to_quaternion() @ Vector((0,1,0))
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
                camera_right=source_up.cross(direction).normalized()
                camera.rotation_euler=Matrix((camera_right,direction.cross(camera_right),direction)).transposed().to_euler()
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


def compact_geometry(doc, blob):
    """Losslessly discard attributes unused by the radiance shader."""
    primitives=[p for mesh in doc.get('meshes',[]) for p in mesh['primitives']]
    if doc.get('skins') or doc.get('animations') or any(p.get('targets') or p.get('extensions') for p in primitives):
        return blob
    used=set()
    for primitive in primitives:
        primitive['attributes']={k:v for k,v in primitive['attributes'].items() if k in {'POSITION','TEXCOORD_0'}}
        used.update(primitive['attributes'].values())
        if 'indices' in primitive:used.add(primitive['indices'])
    indices={old:new for new,old in enumerate(sorted(used))}
    doc['accessors']=[doc['accessors'][old] for old in sorted(used)]
    for primitive in primitives:
        primitive['attributes']={k:indices[v] for k,v in primitive['attributes'].items()}
        if 'indices' in primitive:primitive['indices']=indices[primitive['indices']]
    views={a['bufferView'] for a in doc['accessors'] if 'bufferView' in a}
    views.update(i['bufferView'] for i in doc.get('images',[]) if 'bufferView' in i)
    if any(a.get('sparse') for a in doc['accessors']):
        for a in doc['accessors']:
            for entry in a.get('sparse',{}).values():
                if isinstance(entry,dict) and 'bufferView' in entry:views.add(entry['bufferView'])
    mapping={old:new for new,old in enumerate(sorted(views))};packed=bytearray();new_views=[]
    for old in sorted(views):
        view=dict(doc['bufferViews'][old]);start=view.get('byteOffset',0)
        packed.extend(b'\0'*(-len(packed)%4));view['byteOffset']=len(packed)
        packed.extend(blob[start:start+view['byteLength']]);new_views.append(view)
    for a in doc['accessors']:
        if 'bufferView' in a:a['bufferView']=mapping[a['bufferView']]
        for entry in a.get('sparse',{}).values():
            if isinstance(entry,dict) and 'bufferView' in entry:entry['bufferView']=mapping[entry['bufferView']]
    for image in doc.get('images',[]):
        if 'bufferView' in image:image['bufferView']=mapping[image['bufferView']]
    doc['bufferViews']=new_views
    return packed


def embed(path, material_maps, metadata, lut):
    binary = path.read_bytes()
    length = struct.unpack_from('<I', binary, 12)[0]
    doc = json.loads(binary[20:20+length])
    blob = bytearray(binary[28+length:])
    blob = compact_geometry(doc,blob)
    cache = {}
    def texture(file):
        file = Path(file)
        data = file.read_bytes()
        digest=hashlib.sha256(data).digest()
        if digest in cache:
            return cache[digest]
        blob.extend(b'\0'*(-len(blob)%4))
        view = len(doc.setdefault('bufferViews', []))
        doc['bufferViews'].append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data)})
        blob.extend(data)
        image = len(doc.setdefault('images', []))
        doc['images'].append({'bufferView': view, 'mimeType': 'image/png'})
        index = len(doc.setdefault('textures', []))
        doc['textures'].append({'source': image})
        cache[digest] = index
        return index
    for material in doc.get('materials', []):
        maps = material_maps.get(material.get('name'))
        if maps:
            material.setdefault('extras', {})['studioRadiance'] = {
                'schema': VERSION, 'grid':maps.get('grid',metadata['grid']), 'diffuse': {'texture': texture(maps['diffuse']['path']), 'range': maps['diffuse']['range']},
                'views': [{'texture': texture(v['path']), 'range': v['range']} for v in maps['views']]}
    metadata = {**metadata, 'display': {k:v for k,v in lut.items() if k != 'path'}, 'displayTexture': texture(lut['path'])}
    doc.setdefault('extras', {})['studioRadiance'] = metadata
    doc['buffers'][0]['byteLength'] = len(blob)
    encoded = json.dumps(doc,separators=(',',':')).encode()
    encoded += b' '*(-len(encoded)%4)
    blob.extend(b'\0'*(-len(blob)%4))
    path.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(encoded)+len(blob))+struct.pack('<I4s',len(encoded),b'JSON')+encoded+struct.pack('<I4s',len(blob),b'BIN\0')+blob)


def bake_scene(scene, output, quality, whole_space=False, resolution_override=None, samples_override=None,reuse_root=None,checkpoint_source=None):
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
    # Cycles face-forwards normals for camera rays, but bake rays start along the
    # authored outward normal. Closed inside-out meshes otherwise bake black.
    # References above deliberately retain the unmodified author geometry.
    import bmesh
    repaired=[]
    for obj in meshes:
        bm=bmesh.new();bm.from_mesh(obj.data)
        if bm.faces and all(e.is_manifold for e in bm.edges) and bm.calc_volume(signed=True)<-1e-8:
            bmesh.ops.reverse_faces(bm,faces=list(bm.faces));bm.to_mesh(obj.data);obj.data.update()
            repaired.append(obj.name)
        bm.free()
    grid=[1 if scene.camera.data.type=='ORTHO' else 3,5 if dense_reflections(meshes) else 3]
    checkpoint=None
    if checkpoint_source:
        from checkpoint import BakeCheckpoint
        identity=hashlib.sha256(json.dumps([checkpoint_source,quality,whole_space,resolution_override,samples_override,domain,grid,repaired],sort_keys=True).encode())
        for filename in ('radiance.py','bake.py','hybrid.py','render.py','compose.py','checkpoint.py'):
            identity.update(Path(__file__).with_name(filename).read_bytes())
        checkpoint=BakeCheckpoint(output,identity.hexdigest())
    reuse=read_reuse(reuse_root,domain,grid,set(repaired)) if reuse_root else None
    print('RADIANCE_NORMAL_REPAIRS',repaired,flush=True)
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
    source_uvs={obj:obj.data.uv_layers.active.name if obj.data.uv_layers.active else '' for obj in meshes}
    def replace_later(name,objects,cache_maps):
        mat=bpy.data.materials.new('Radiance '+name);mat.use_nodes=True;mat.node_tree.nodes.clear()
        emit=mat.node_tree.nodes.new('ShaderNodeEmission');out=mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
        mat.node_tree.links.new(emit.outputs[0],out.inputs['Surface'])
        maps[mat.name]=cache_maps;replacements.append((objects,mat))
    cursor = 0
    while cursor < len(groups):
        name, objects, _ = groups[cursor]
        cursor += 1
        group_grid=[grid[0],5 if dense_reflections(objects) else 3]
        resolution = resolution_override or (1024 if '_detail' in name and quality=='preview' else 2048)
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
            old_uv = source_uvs[obj]
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
        # Verify actual raster coverage, not merely legal UV coordinates. Blender
        # can leave large faces unrecorded when an atlas is densely packed.
        probe=new_image(name+' coverage',resolution)
        for mat in clones.values():mat.node_tree.nodes.active.image=probe
        scene.cycles.samples=1
        with bake_log():bpy.ops.object.bake(type='DIFFUSE',pass_filter={'COLOR'},uv_layer=UV_NAME,margin=0)
        missing=uncovered_surfaces(objects,probe);bpy.data.images.remove(probe)
        if missing:
            bpy.data.images.remove(target)
            if len(objects)<2 or name.count('_p')>=12:raise ValueError('Unrecorded surface: '+', '.join(missing))
            mid=len(objects)//2;groups[cursor:cursor]=[(name+'_p0',objects[:mid],resolution),(name+'_p1',objects[mid:],resolution)]
            print('RADIANCE_SPLIT_UNCOVERED',name,missing,flush=True)
            continue
        cached=reuse(name,objects,output,group_grid) if reuse else None
        geometry=hashlib.sha256()
        for obj in objects:
            geometry.update(obj.name.encode())
            geometry.update(np.array(obj.matrix_world,dtype='<f4').tobytes())
            geometry.update(np.array([tuple(p.uv) for p in obj.data.uv_layers[UV_NAME].data],dtype='<f4').tobytes())
        geometry=geometry.hexdigest()
        resumed=checkpoint.get(name,geometry,'diffuse') if checkpoint else None
        if resumed:
            cached=({'diffuse':resumed[0],'views':[]},[resumed[1]])
        if cached and cached[0]['views'] and all(cached[0]['views']):
            replace_later(name,objects,cached[0]);atlases.extend(cached[1]+[v['entry'] for v in cached[0]['views']]);bpy.data.images.remove(target)
            print('RADIANCE_REUSE',name,flush=True)
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
            if np.all(encoded==encoded[0,0]):
                encoded=encoded[:1,:1]
            write_png(path,encoded)
            bpy.data.images.remove(clean)
            linear.unlink()
            atlases.append({'name':path.name,'width':encoded.shape[1],'height':encoded.shape[0],'kind':suffix,'objects':len(objects)})
            result={'path':path,'range':scale}
            if checkpoint:checkpoint.put(name,geometry,suffix,result,atlases[-1])
            return result
        if cached:
            diffuse=cached[0]['diffuse'];atlases.extend(cached[1]);print('RADIANCE_REUSE_DIFFUSE',name,flush=True)
        else:
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
        for e in range(group_grid[1]):
            for a in range(group_grid[0]):
                index=e*group_grid[0]+a
                resumed=checkpoint.get(name,geometry,'view'+str(index)) if checkpoint else None
                if not resumed and cached and cached[0]['views'] and cached[0]['views'][index]:
                    item=cached[0]['views'][index];resumed=(item,item['entry'])
                if resumed:
                    views.append(resumed[0]);atlases.append(resumed[1])
                    print('RADIANCE_VIEW_RESUMED',name,e*grid[0]+a,flush=True)
                    continue
                az = domain['azimuth'] if grid[0]==1 else domain['azimuthRange'][0]+a/2*(domain['azimuthRange'][1]-domain['azimuthRange'][0])
                el = domain['elevationRange'][0]+e/(group_grid[1]-1)*(domain['elevationRange'][1]-domain['elevationRange'][0])
                direction = Vector((math.sin(az)*math.cos(el),-math.cos(az)*math.cos(el),math.sin(el)))
                # Bake rays are effectively parallel. Runtime evaluates directions per fragment.
                scene.camera.data.type = 'PERSP'
                scene.camera.location = (low+high)*.5+direction*domain['span']*10000
                scene.camera.rotation_euler = (-direction).to_track_quat('-Z','Y').to_euler()
                bpy.context.view_layer.update()
                bake(glossy,{'COLOR','DIRECT','INDIRECT','GLOSSY','TRANSMISSION'})
                views.append(save(glossy,'view'+str(e*grid[0]+a)))
                print('RADIANCE_VIEW',name,e*grid[0]+a,flush=True)
        bpy.data.images.remove(glossy)
        scene.camera.matrix_world = source_matrix.copy()
        scene.camera.data.type = source_type
        replace_later(name,objects,{'diffuse':diffuse,'views':views,'grid':group_grid})
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
    embed(path,maps,{'schema':VERSION,'domain':domain,'lighting':source,'grid':grid,
                    'warnings':audit['warnings'],'static':True},lut)
    data = path.read_bytes()
    if len(data)>96*1024**2:
        raise ValueError('Radiance GLB exceeds 96 MiB; split the scene or reduce atlas resolution.')
    return {'schema':1,'radianceVersion':VERSION,'bakerVersion':10,'file':'baked.glb','bytes':len(data),'coverageThreshold':.002,
            'sha256':hashlib.sha256(data).hexdigest(),'samples':samples,'triangles':triangles,'atlases':atlases,
            'compatibility':audit,'domain':domain,'directionSamples':grid[0]*grid[1],'normalRepairs':repaired,'seconds':round(time.monotonic()-start,2),
            'limitations':['Static current frame','Bounded directional approximation; sharp reflections/transmission require denser sampling',
                           'No volumes or arbitrary compositor effects','Camera must remain inside declared domain']}
