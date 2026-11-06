"""Static Cycles -> display-referred unlit GLB. Trusted worker, never runs upload code.

Opaque surfaces use actual Cycles combined lighting. Transmissive/transparent
surfaces remain PBR; their view-dependent effects are explicitly approximate.
"""
import hashlib
import math
import time
from pathlib import Path

UV_NAME = 'StudioBakeUV'
BAKER_VERSION = 3


def surface_area(obj):
    """Measure evaluated world-space area, independent of object scale/names."""
    area=0
    for polygon in obj.data.polygons:
        vertices=[obj.matrix_world @ obj.data.vertices[i].co for i in polygon.vertices]
        area+=sum((vertices[i]-vertices[0]).cross(vertices[i+1]-vertices[0]).length*.5 for i in range(1,len(vertices)-1))
    return area


def atlas_groups(objects, whole_space, quality):
    """Keep tiny bevel/prop islands out of large architectural surface atlases."""
    modules={}
    for obj in objects:modules.setdefault(obj.get('studioModule','surfaces') if whole_space else 'surfaces',[]).append(obj)
    result=[]
    for name,members in sorted(modules.items()):
        areas={obj:surface_area(obj) for obj in members}
        threshold=max(areas.values())*.02
        large=[obj for obj in members if areas[obj]>=threshold]
        detail=[obj for obj in members if areas[obj]<threshold]
        result.append((name,large,2048))
        if detail:result.append((name+'_detail',detail,2048))
    return result


def protect_thin_islands(mesh, minimum):
    """Reserve texels for bevels/painted lines that would otherwise bake black."""
    uv=mesh.uv_layers[UV_NAME].data
    parent=list(range(len(uv)))
    def root(i):
        while parent[i]!=i:
            parent[i]=parent[parent[i]];i=parent[i]
        return i
    def union(a,b):parent[root(a)]=root(b)
    shared={}
    for polygon in mesh.polygons:
        loops=list(polygon.loop_indices)
        for i in loops:
            union(loops[0],i)
            key=(mesh.loops[i].vertex_index,round(uv[i].uv.x,6),round(uv[i].uv.y,6))
            if key in shared:union(i,shared[key])
            else:shared[key]=i
    islands={}
    for i in range(len(uv)):islands.setdefault(root(i),[]).append(i)
    for loops in islands.values():
        for axis in range(2):
            low=min(uv[i].uv[axis] for i in loops);high=max(uv[i].uv[axis] for i in loops)
            if 0<high-low<minimum:
                center=(low+high)*.5;factor=minimum/(high-low)
                for i in loops:uv[i].uv[axis]=center+(uv[i].uv[axis]-center)*factor


def validate_uv(objects):
    # Blender can collapse UVs when the requested island padding cannot fit.
    # Fail before lighting instead of silently exporting a black atlas.
    for obj in objects:
        uv=obj.data.uv_layers[UV_NAME].data
        if any(not math.isfinite(c) or c < -.0001 or c > 1.0001 for loop in uv for c in loop.uv):
            raise ValueError('UV atlas overflow: '+obj.name)
        area=0
        for polygon in obj.data.polygons:
            points=[uv[i].uv for i in polygon.loop_indices]
            area+=sum(abs((points[i].x-points[0].x)*(points[i+1].y-points[0].y)-(points[i].y-points[0].y)*(points[i+1].x-points[0].x))*.5 for i in range(1,len(points)-1))
        if area < 1e-12:raise ValueError('UV atlas collapsed: split or simplify this mesh: '+obj.name)


def unwrap_objects(objects, resolution, detail=False):
    import bpy
    from mathutils import Matrix
    from array import array
    # UV operators measure local mesh coordinates. Account for object scale
    # temporarily so tiny scaled spheres do not consume most of the atlas.
    # Restore exact coordinates before Cycles evaluates procedural materials.
    coordinates=[]
    for obj in objects:
        saved=array('f',[0.0])*(len(obj.data.vertices)*3)
        obj.data.vertices.foreach_get('co',saved);coordinates.append((obj,saved))
        scale=obj.matrix_world.to_scale()
        obj.data.transform(Matrix.Diagonal((scale.x,scale.y,scale.z,1)))
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(45),island_margin=.002,area_weight=.1,correct_aspect=True,scale_to_bounds=True)
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True,rotate_method='CARDINAL',shape_method='AABB',margin_method='FRACTION',margin=10/resolution)
    bpy.ops.object.mode_set(mode='OBJECT')
    for _ in range(2):
        for obj in objects:protect_thin_islands(obj.data,(6 if detail else 2)/resolution)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.uv.select_all(action='SELECT')
        bpy.ops.uv.pack_islands(rotate=True,rotate_method='CARDINAL',shape_method='AABB',margin_method='FRACTION',margin=10/resolution)
        bpy.ops.object.mode_set(mode='OBJECT')
    for obj,saved in coordinates:
        obj.data.vertices.foreach_set('co',saved);obj.data.update()
    validate_uv(objects)


def pad_bake_images(images, radius=8, coverage=None):
    """Extend only valid baked texels, never the baker's noisy edge extrapolation.

    Share one nearest-texel map across color/albedo/normal so guidance stays
    aligned. Alpha from a zero-margin bake is the exact raster coverage mask.
    """
    import numpy as np
    width,height=images[0].size
    pixels=np.empty(width*height*4,dtype=np.float32)
    images[0].pixels.foreach_get(pixels)
    valid=coverage if coverage is not None else pixels.reshape((height,width,4))[:,:,3]>.5
    y,x=np.indices((height,width),dtype=np.int32)
    sx=np.where(valid,x,-1);sy=np.where(valid,y,-1)
    distance=np.where(valid,0,radius*radius+1)
    for _ in range(radius):
        changed=False
        for dy,dx in ((-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)):
            nx=np.roll(sx,(dy,dx),(0,1));ny=np.roll(sy,(dy,dx),(0,1))
            candidate=(nx-x)**2+(ny-y)**2
            take=(nx>=0)&(candidate<distance)&(candidate<=radius*radius)
            if np.any(take):
                sx[take]=nx[take];sy[take]=ny[take];distance[take]=candidate[take];changed=True
        if not changed:break
    fill=(~valid)&(distance<=radius*radius)
    for image in images:
        image.pixels.foreach_get(pixels)
        data=pixels.reshape((height,width,4))
        data[fill]=data[sy[fill],sx[fill]]
        image.pixels.foreach_set(pixels);image.update()


def save_denoised(image, path, source_scene, albedo=None, normal=None):
    """Use Blender's bundled OpenImageDenoise, then the source OCIO transform."""
    import bpy
    post=bpy.data.scenes.new('Studio texture denoise')
    post.render.engine='CYCLES';post.cycles.device='CPU';post.cycles.samples=1
    post.render.threads_mode='FIXED';post.render.threads=source_scene.render.threads
    post.render.resolution_x=image.size[0];post.render.resolution_y=image.size[1];post.render.resolution_percentage=100
    post.view_settings.view_transform=source_scene.view_settings.view_transform
    post.view_settings.look=source_scene.view_settings.look
    post.view_settings.exposure=source_scene.view_settings.exposure
    post.view_settings.gamma=source_scene.view_settings.gamma
    post.render.image_settings.file_format='PNG';post.render.image_settings.color_mode='RGB';post.render.image_settings.color_depth='8'
    post.render.filepath=str(path)
    camera=bpy.data.objects.new('Studio denoise camera',bpy.data.cameras.new('Studio denoise camera'))
    post.collection.objects.link(camera);post.camera=camera
    post.use_nodes=True;nodes=post.node_tree.nodes;nodes.clear();links=post.node_tree.links
    source=nodes.new('CompositorNodeImage');source.image=image
    denoise=nodes.new('CompositorNodeDenoise');denoise.use_hdr=True
    composite=nodes.new('CompositorNodeComposite')
    links.new(source.outputs['Image'],denoise.inputs['Image']);links.new(denoise.outputs['Image'],composite.inputs['Image'])
    for label,guide in [('Albedo',albedo),('Normal',normal)]:
        if guide:
            node=nodes.new('CompositorNodeImage');node.image=guide
            links.new(node.outputs['Image'],denoise.inputs[label])
    if albedo:denoise.prefilter='ACCURATE'
    try:
        bpy.ops.render.render(scene=post.name,write_still=True)
        import struct
        if not path.is_file() or struct.unpack('>II',path.read_bytes()[16:24])!=tuple(image.size):
            raise ValueError('Denoising did not produce a texture of the requested size')
    finally:
        bpy.context.window.scene=source_scene
        bpy.data.scenes.remove(post)
        bpy.data.objects.remove(camera,do_unlink=True)


def bake_scene(scene, output, quality, whole_space=False):
    import bpy
    from mathutils import Vector
    start = time.monotonic()
    meshes = [o for o in scene.objects if o.type == 'MESH' and not o.hide_render and o.visible_get()]
    limit=1800 if whole_space else 600
    if not meshes or len(meshes) > limit:
        raise ValueError('Baking supports 1–'+str(limit)+' visible mesh objects')
    unsupported = [o.name for o in scene.objects if o.type in {'VOLUME', 'CURVE', 'FONT', 'META', 'SURFACE'} and not o.hide_render]
    if unsupported:
        raise ValueError('Convert these objects to meshes before baking: ' + ', '.join(unsupported[:10]))
    if any(o.instance_type != 'NONE' or any(m.type in {'NODES','PARTICLE_SYSTEM'} for m in o.modifiers) for o in meshes):
        raise ValueError('Realize procedural/particle instances before baking')
    bpy.ops.object.select_all(action='DESELECT')
    # Freeze the evaluated current frame including bevel/subdivision geometry.
    deps = bpy.context.evaluated_depsgraph_get()
    evaluated = [(o, bpy.data.meshes.new_from_object(o.evaluated_get(deps), preserve_all_data_layers=True, depsgraph=deps)) for o in meshes]
    triangles = sum(sum(len(p.vertices)-2 for p in mesh.polygons) for _, mesh in evaluated)
    if triangles > 1_500_000:
        raise ValueError('Baking exceeds the 1.5-million triangle limit')
    for obj, mesh in evaluated:
        obj.data = mesh
        obj.modifiers.clear()
        obj.hide_select = False
    def bounds(objects):
        points = [o.matrix_world @ Vector(c) for o in objects for c in o.bound_box]
        return [Vector(tuple(min(p[k] for p in points) for k in range(3))), Vector(tuple(max(p[k] for p in points) for k in range(3)))]
    # A very large, flat studio backdrop is not part of the grid module bounds.
    backdrop = next((o for o in meshes if o.get('studioKeepBackdrop')),None) or max(meshes, key=lambda o:o.dimensions.x*o.dimensions.y)
    others = [o for o in meshes if o != backdrop]
    low, high = bounds(others or meshes)
    span = max(high.x-low.x, high.y-low.y, 1)
    is_backdrop = backdrop.get('studioKeepBackdrop') or (len(others)>0 and backdrop.dimensions.z < span*.04 and backdrop.dimensions.x>span*3 and backdrop.dimensions.y>span*3)
    if is_backdrop and not backdrop.get('studioKeepBackdrop'):
        z = max((backdrop.matrix_world @ Vector(c)).z for c in backdrop.bound_box)
        center = (low+high)*.5
        radius = max(span*2.3, scene.camera.data.ortho_scale*1.5 if scene.camera.data.type=='ORTHO' else span*3)
        inv = backdrop.matrix_world.inverted()
        vertices = [inv @ Vector((center.x+x*radius,center.y+y*radius,z)) for x,y in [(-1,-1),(1,-1),(1,1),(-1,1)]]
        material = backdrop.data.materials[0] if backdrop.data.materials else None
        plane = bpy.data.meshes.new('Studio backdrop surface');plane.from_pydata(vertices,[],[(0,1,2,3)]);plane.update()
        if material:plane.materials.append(material)
        backdrop.data=plane;backdrop['studioBackdrop']=True
    elif not is_backdrop:
        backdrop=None
    def dynamic_material(mat):
        if not mat or not mat.use_nodes:return False
        for node in mat.node_tree.nodes:
            if node.type in {'BSDF_GLASS','BSDF_TRANSPARENT','BSDF_REFRACTION'}:return True
            if node.type=='BSDF_PRINCIPLED':
                transmission=node.inputs.get('Transmission') or node.inputs.get('Transmission Weight')
                alpha=node.inputs.get('Alpha')
                if transmission and (transmission.is_linked or transmission.default_value>.01):return True
                if alpha and (alpha.is_linked or alpha.default_value<.99):return True
        return False
    dynamic=[o for o in meshes if any(dynamic_material(m) for m in o.data.materials)]
    opaque=[o for o in meshes if o not in dynamic and o != backdrop]
    if not opaque:raise ValueError('No opaque surfaces to bake')
    size=1024 if quality=='preview' else 2048
    samples=64 if quality=='preview' else 192
    scene.cycles.samples=samples
    scene.cycles.use_denoising=False
    scene.render.bake.use_selected_to_active=False
    scene.render.bake.use_clear=True
    # Cycles' edge extrapolation can contaminate small bevels. Denoise the
    # actual rasterized texels first; extend their clean colors afterward.
    scene.render.bake.margin=0
    scene.render.bake.margin_type='EXTEND'
    scene.render.bake.use_pass_direct=True
    scene.render.bake.use_pass_indirect=True
    scene.render.bake.use_pass_diffuse=True
    scene.render.bake.use_pass_glossy=False
    scene.render.bake.use_pass_transmission=False
    scene.render.bake.use_pass_emit=True
    scene.render.bake.use_pass_color=True
    scene.render.bake.view_from='ABOVE_SURFACE'
    atlases=[]
    replacements=[]
    groups=atlas_groups(opaque,whole_space,quality)
    for name, objects, resolution in groups+[('backdrop',[backdrop] if backdrop else [],size)]:
        if not objects:continue
        print('STUDIO_BAKE_STAGE unwrap',name,len(objects),flush=True)
        image=bpy.data.images.new('Studio_'+name,resolution,resolution,alpha=False,float_buffer=True)
        image.generated_color=(0,0,0,1)
        clones={}
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            old_uv=obj.data.uv_layers.active.name if obj.data.uv_layers.active else ''
            layer=obj.data.uv_layers.get(UV_NAME) or obj.data.uv_layers.new(name=UV_NAME)
            obj.data.uv_layers.active=layer
            if old_uv:obj.data.uv_layers[old_uv].active_render=True
            for i,mat in enumerate(list(obj.data.materials)):
                if not mat:raise ValueError('Assign a material to '+obj.name)
                key=(mat.name,old_uv)
                if key not in clones:
                    copy=mat.copy();copy.use_nodes=True
                    nodes=copy.node_tree.nodes;links=copy.node_tree.links
                    # Adding a bake UV must not change the source material's implicit UV.
                    if old_uv:
                        uv=nodes.new('ShaderNodeUVMap');uv.uv_map=old_uv
                        for node in list(nodes):
                            if node.type=='TEX_IMAGE' and not node.inputs['Vector'].is_linked:links.new(uv.outputs['UV'],node.inputs['Vector'])
                            if node.type=='TEX_COORD':
                                for link in list(node.outputs['UV'].links):links.new(uv.outputs['UV'],link.to_socket)
                    tex=nodes.new('ShaderNodeTexImage');tex.image=image
                    for node in nodes:node.select=False
                    tex.select=True;nodes.active=tex
                    clones[key]=copy
                obj.data.materials[i]=clones[key]
            obj.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        unwrap_objects(objects,resolution,name.endswith('_detail'))
        print('STUDIO_BAKE_STAGE cycles',name,resolution,samples,flush=True)
        bpy.ops.object.bake(type='COMBINED',margin=0,pass_filter={'DIRECT','INDIRECT','DIFFUSE','EMIT','COLOR'},uv_layer=UV_NAME)
        # Guidance prevents the denoiser treating real material/normal detail as
        # lighting noise. Guides use the SAME UVs and original source shaders.
        guides=[]
        scene.cycles.samples=4  # Deterministic color/normal guides need no path-traced GI samples.
        for kind in ('DIFFUSE','NORMAL'):
            print('STUDIO_BAKE_STAGE guide',name,kind,flush=True)
            guide=bpy.data.images.new('Studio guide '+kind,resolution,resolution,alpha=False,float_buffer=True)
            guide.colorspace_settings.name='Non-Color'
            for material in clones.values():material.node_tree.nodes.active.image=guide
            if kind=='DIFFUSE':bpy.ops.object.bake(type=kind,margin=0,pass_filter={'COLOR'},uv_layer=UV_NAME)
            else:bpy.ops.object.bake(type=kind,margin=0,normal_space='OBJECT',uv_layer=UV_NAME)
            guides.append(guide)
        scene.cycles.samples=samples
        # A normal bake encodes [-1,1] as [0,1]; OIDN expects signed normals.
        import numpy as np
        pixels=np.empty(resolution*resolution*4,dtype=np.float32)
        guides[1].pixels.foreach_get(pixels);pixels=pixels.reshape((-1,4));pixels[:,:3]=pixels[:,:3]*2-1
        guides[1].pixels.foreach_set(pixels.ravel());guides[1].update()
        for material in clones.values():material.node_tree.nodes.active.image=image
        path=output/(name+'.png')
        scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB';scene.render.image_settings.color_depth='8'
        # Apply the SOURCE OCIO view/look/exposure exactly once to the baked pixels.
        save_denoised(image,path,scene,*guides)
        for guide in guides:bpy.data.images.remove(guide)
        display=bpy.data.images.load(str(path),check_existing=False);display.colorspace_settings.name='sRGB'
        image.pixels.foreach_get(pixels.ravel())
        coverage=pixels.reshape((resolution,resolution,4))[:,:,3]>.5
        pad_bake_images([display],coverage=coverage)
        # save() preserves the already applied source OCIO view; save_render()
        # here would incorrectly apply Filmic a second time.
        display.filepath_raw=str(path);display.file_format='PNG';display.save()
        material=bpy.data.materials.new('Studio baked '+name);material.use_nodes=True
        nodes=material.node_tree.nodes;nodes.clear();links=material.node_tree.links
        tex=nodes.new('ShaderNodeTexImage');tex.image=display;tex.interpolation='Linear'
        uv=nodes.new('ShaderNodeUVMap');uv.uv_map=UV_NAME;links.new(uv.outputs['UV'],tex.inputs['Vector'])
        # This supported glTF exporter arrangement produces KHR_materials_unlit.
        out=nodes.new('ShaderNodeOutputMaterial');links.new(tex.outputs['Color'],out.inputs['Surface'])
        replacements.append((objects,material))
        display.pack();atlases.append({'name':name+'.png','width':resolution,'height':resolution,'objects':len(objects)})
        bpy.data.images.remove(image)
    # Keep every original shader in place until ALL light transport is baked.
    for objects, material in replacements:
        for obj in objects:
            obj.data.materials.clear();obj.data.materials.append(material)
            for polygon in obj.data.polygons:polygon.material_index=0
            obj['studioBaked']=True
            obj.data.uv_layers.active=obj.data.uv_layers[UV_NAME];obj.data.uv_layers[UV_NAME].active_render=True
    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes+[scene.camera]:obj.select_set(True)
    bpy.context.view_layer.objects.active=opaque[0]
    scene['studioBake']={'schema':1,'displayReferred':True,'viewTransform':scene.view_settings.view_transform,'look':scene.view_settings.look}
    path=output/'baked.glb'
    print('STUDIO_BAKE_STAGE export',flush=True)
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,use_active_scene=True,export_cameras=True,export_lights=False,export_extras=True,export_animations=False,export_texcoords=True,export_normals=True,export_materials='EXPORT')
    if path.stat().st_size>48*1024**2:raise ValueError('Baked GLB exceeds 48 MiB; use preview quality')
    # Assert portable unlit materials before reporting a successful conversion.
    import json,struct
    data=path.read_bytes();gltf=json.loads(data[20:20+struct.unpack_from('<I',data,12)[0]])
    baked_materials=[m for m in gltf.get('materials',[]) if m['name'].startswith('Studio baked ')]
    if not baked_materials or any('KHR_materials_unlit' not in m.get('extensions',{}) for m in baked_materials):
        raise ValueError('Exporter did not produce unlit baked materials')
    return {'schema':1,'bakerVersion':BAKER_VERSION,'file':'baked.glb','bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),
            'displayReferred':True,'viewTransform':scene.view_settings.view_transform,'look':scene.view_settings.look,
            'opaqueObjects':len(opaque),'dynamicObjects':[o.name for o in dynamic],
            'backdrop':backdrop.name if backdrop else None,'atlases':atlases,'samples':samples,'guideSamples':4,
            'triangles':triangles,'denoise':'OpenImageDenoise with albedo and signed normal guides','padding':'8px nearest covered texel after denoising','seconds':round(time.monotonic()-start,2),
            'limitations':['Static lighting and current frame only','Glass and transparency remain approximate PBR','Glossy view-dependent highlights are not baked','Volumes, procedural instances and non-mesh geometry require preparation']}
