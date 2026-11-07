"""Linear indirect diffuse lightmaps + live PBR. Uploads never execute scripts.

The lightmap stores indirect diffuse outgoing radiance without surface color.
The browser decodes RGBM and multiplies by pi before the Lambert BRDF. Direct
lighting, normal response and specular remain live; no display transform is
baked into these textures. All original shaders stay until transport finishes.
"""
import hashlib
import json
import math
import struct
import time
import contextlib
import os
import sys
from bake import UV_NAME, atlas_groups, unwrap_objects, pad_bake_images, save_denoised

HYBRID_VERSION=1


@contextlib.contextmanager
def bake_log():
    """Cycles repeats the whole object inventory for every baked object."""
    if os.getenv('STUDIO_VERBOSE')=='1':
        yield;return
    sys.stdout.flush();saved=os.dup(1)
    try:
        with open(os.devnull,'w') as sink:
            os.dup2(sink.fileno(),1)
            yield
    finally:
        sys.stdout.flush();os.dup2(saved,1);os.close(saved)


def inject_lightmaps(path, maps, lighting):
    data=path.read_bytes();length=struct.unpack_from('<I',data,12)[0]
    doc=json.loads(data[20:20+length]);start=20+length
    binary=bytearray(data[start+8:start+8+struct.unpack_from('<I',data,start)[0]])
    for material in doc.get('materials',[]):
        spec=maps.get(material.get('name'))
        if not spec:continue
        while len(binary)%4:binary.append(0)
        png=spec['path'].read_bytes();offset=len(binary);binary.extend(png)
        views=doc.setdefault('bufferViews',[]);view=len(views)
        views.append({'buffer':0,'byteOffset':offset,'byteLength':len(png)})
        images=doc.setdefault('images',[]);index=len(images)
        images.append({'bufferView':view,'mimeType':'image/png','name':spec['path'].stem})
        textures=doc.setdefault('textures',[]);texture=len(textures)
        textures.append({'source':index})
        material.setdefault('extras',{})['studioLightMap']={'texture':texture,'texCoord':0,'encoding':'RGBM','range':spec['range'],'indirectOnly':True}
        if 'KHR_materials_unlit' in material.get('extensions',{}):raise ValueError('Hybrid material cannot be unlit')
    doc['buffers'][0]['byteLength']=len(binary)
    doc.setdefault('extras',{})['studioHybrid']={'schema':HYBRID_VERSION,'lighting':lighting}
    encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
    binary+=b'\0'*((-len(binary))%4)
    path.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(encoded)+len(binary))+struct.pack('<I4s',len(encoded),b'JSON')+encoded+struct.pack('<I4s',len(binary),b'BIN\0')+binary)


def encode_rgbm(pixels):
    import numpy as np
    rgb=np.maximum(pixels[...,:3],0)
    if not np.isfinite(rgb).all():raise ValueError('Non-finite irradiance')
    scale=max(1,2**math.ceil(math.log2(max(float(rgb.max()),.00001))))
    multiplier=np.ceil(np.clip(rgb.max(axis=-1)/scale,0,1)*255)/255
    result=np.zeros_like(pixels)
    result[...,:3]=rgb/np.maximum(multiplier[...,None]*scale,1e-8)
    result[...,3]=multiplier
    return result,scale


def write_png(path,pixels,color=False):
    """Write explicit 8-bit data; normal/RGBM maps must never pass through OCIO."""
    import numpy as np
    import zlib
    data=np.array(pixels,copy=True)
    if color:
        rgb=data[...,:3];data[...,:3]=np.where(rgb<=.0031308,rgb*12.92,1.055*np.maximum(rgb,0)**(1/2.4)-.055)
    rgba=np.rint(np.clip(data,0,1)*255).astype(np.uint8)
    path.write_bytes(pack_png(rgba[::-1]))


def pack_png(rgba):
    """Lossless adaptive PNG filtering keeps detailed normal atlases compact."""
    import numpy as np
    import zlib
    height,width=rgba.shape[:2];rows=[];previous=np.zeros(width*4,dtype=np.int16)
    for row in rgba:
        current=row.reshape(-1).astype(np.int16);left=np.zeros_like(current);left[4:]=current[:-4]
        upper_left=np.zeros_like(current);upper_left[4:]=previous[:-4]
        prediction=left+previous-upper_left
        a=np.abs(prediction-left);b=np.abs(prediction-previous);c=np.abs(prediction-upper_left)
        paeth=np.where((a<=b)&(a<=c),left,np.where(b<=c,previous,upper_left))
        candidates=[current,current-left,current-previous,current-(left+previous)//2,current-paeth]
        encoded=[np.bitwise_and(value,255).astype(np.uint8) for value in candidates]
        scores=[int(np.minimum(value.astype(np.int16),256-value.astype(np.int16)).sum()) for value in encoded]
        choice=min(range(5),key=lambda i:scores[i]);rows.append(bytes([choice])+encoded[choice].tobytes());previous=current
    def chunk(kind,content):return struct.pack('>I',len(content))+kind+content+struct.pack('>I',zlib.crc32(kind+content)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows),9))+chunk(b'IEND',b'')



def dynamic_material(mat):
    if not mat or not mat.use_nodes:return False
    for node in mat.node_tree.nodes:
        if node.type in {'BSDF_GLASS','BSDF_TRANSPARENT','BSDF_REFRACTION','EMISSION'}:return True
        if node.type=='BSDF_PRINCIPLED':
            for name,threshold in [('Transmission',.01),('Transmission Weight',.01),('Metallic',.1)]:
                v=node.inputs.get(name)
                if v and (v.is_linked or v.default_value>threshold):return True
            v=node.inputs.get('Alpha')
            if v and (v.is_linked or v.default_value<.99):return True
            emission=node.inputs.get('Emission') or node.inputs.get('Emission Color')
            strength=node.inputs.get('Emission Strength')
            if emission and (emission.is_linked or max(emission.default_value[:3])>.001) and (not strength or strength.is_linked or strength.default_value>.001):return True
    return False


def bake_scene(scene,output,quality,whole_space=False,resolution_override=None,samples_override=None):
    import bpy
    import numpy as np
    from mathutils import Vector
    from render import web_scene
    start=time.monotonic();lighting=web_scene(scene)
    meshes=[o for o in scene.objects if o.type=='MESH' and not o.hide_render and o.visible_get()]
    if not 1<=len(meshes)<=12000:raise ValueError('Hybrid baking supports 1–12000 visible meshes')
    if any(o.type in {'VOLUME','CURVE','FONT','META','SURFACE'} and not o.hide_render for o in scene.objects):raise ValueError('Convert non-mesh geometry before baking')
    if any(o.instance_type!='NONE' or any(m.type in {'NODES','PARTICLE_SYSTEM'} for m in o.modifiers) for o in meshes):raise ValueError('Realize procedural instances before baking')
    deps=bpy.context.evaluated_depsgraph_get()
    evaluated=[(o,bpy.data.meshes.new_from_object(o.evaluated_get(deps),preserve_all_data_layers=True,depsgraph=deps)) for o in meshes]
    triangles=sum(sum(len(p.vertices)-2 for p in mesh.polygons) for _,mesh in evaluated)
    if triangles>3_000_000:raise ValueError('Hybrid baking exceeds 3 million triangles')
    for obj,mesh in evaluated:
        obj.data=mesh;obj.modifiers.clear();obj.hide_select=False
    backdrop=next((o for o in meshes if o.get('studioKeepBackdrop')),None) or max(meshes,key=lambda o:o.dimensions.x*o.dimensions.y)
    others=[o for o in meshes if o!=backdrop]
    points=[o.matrix_world@Vector(c) for o in others or meshes for c in o.bound_box]
    low=Vector(tuple(min(p[k] for p in points) for k in range(3)));high=Vector(tuple(max(p[k] for p in points) for k in range(3)))
    span=max(high.x-low.x,high.y-low.y,1)
    if not (backdrop.get('studioKeepBackdrop') or backdrop.dimensions.z<span*.04 and backdrop.dimensions.x>span*3 and backdrop.dimensions.y>span*3):backdrop=None
    if backdrop:
        backdrop['studioBackdrop']=True
        # Bound the otherwise enormous studio plane so it receives useful texels.
        z=max((backdrop.matrix_world@Vector(c)).z for c in backdrop.bound_box);center=(low+high)*.5;radius=span*1.25
        inverse=backdrop.matrix_world.inverted();material=backdrop.data.materials[0]
        plane=bpy.data.meshes.new('Hybrid floor');plane.from_pydata([inverse@Vector((center.x+x*radius,center.y+y*radius,z)) for x,y in [(-1,-1),(1,-1),(1,1),(-1,1)]],[],[(0,1,2,3)]);plane.materials.append(material);plane.update();backdrop.data=plane
    from web_bake import bake_receivers, apply_receivers
    receivers = [o for o in meshes if o.get('studioWebBake')]
    dynamic=[o for o in meshes if o not in receivers and any(dynamic_material(m) for m in o.data.materials)]
    opaque=[o for o in meshes if o not in dynamic and o not in receivers and o!=backdrop]
    if not opaque and not receivers:raise ValueError('No opaque surfaces to bake')
    samples=samples_override or (96 if quality=='preview' else 256)
    scene.cycles.samples=samples;scene.cycles.use_denoising=False
    scene.render.bake.use_selected_to_active=False;scene.render.bake.use_clear=True;scene.render.bake.margin=0
    scene.render.bake.margin_type='EXTEND';scene.render.bake.view_from='ABOVE_SURFACE'
    receiver_resolution = resolution_override or (1024 if quality == 'preview' else 2048)
    receiver_changes = bake_receivers(scene, receivers, output, receiver_resolution, samples)
    # Receiver floors still establish module scale. Removing them from the area
    # comparison would promote chairs and hangers to architectural 2K atlases.
    receiver_set = set(receivers)
    groups = []
    scale_reference = opaque + [obj for obj in receivers if obj != backdrop]
    for name, members, resolution in atlas_groups(scale_reference, whole_space, quality):
        pending = [obj for obj in members if obj not in receiver_set]
        if pending:
            groups.append((name, pending, resolution))
    if backdrop and backdrop not in receiver_set:
        groups.append(('backdrop', [backdrop], 2048))
    atlases=[];replacements=[];maps={}
    cursor=0
    while cursor<len(groups):
        name,objects,resolution=groups[cursor];cursor+=1
        resolution=resolution_override or (1024 if '_detail' in name and quality=='preview' else resolution)
        # Bound island density AND Cycles' per-object scene synchronization cost.
        if len(objects)>128 or sum(len(o.data.polygons) for o in objects)>60000 and len(objects)>1:
            midpoint=len(objects)//2
            groups[cursor:cursor]=[(name+'_p0',objects[:midpoint],resolution),(name+'_p1',objects[midpoint:],resolution)]
            continue
        print('STUDIO_HYBRID unwrap',name,len(objects),resolution,flush=True)
        bpy.ops.object.select_all(action='DESELECT');clones={}
        light_resolution=min(resolution,(512 if '_detail' in name else 1024)*(2 if quality=='original' else 1))
        def new_image(label,size=None):
            size=size or resolution
            image=bpy.data.images.new(name+'_'+label,size,size,alpha=True,float_buffer=True)
            image.generated_color=(0,0,0,0);image.colorspace_settings.name='Non-Color';image.alpha_mode='STRAIGHT'
            return image
        indirect=new_image('indirect',light_resolution)
        for obj in objects:
            old_uv=obj.data.uv_layers.active.name if obj.data.uv_layers.active else ''
            layer=obj.data.uv_layers.get(UV_NAME) or obj.data.uv_layers.new(name=UV_NAME)
            obj.data.uv_layers.active=layer;layer.active_render=True
            for i,mat in enumerate(list(obj.data.materials)):
                if not mat:raise ValueError('Assign a material to '+obj.name)
                key=(mat.name,old_uv)
                if key not in clones:
                    copy=mat.copy();copy.use_nodes=True;nodes=copy.node_tree.nodes;links=copy.node_tree.links
                    if old_uv:
                        uv=nodes.new('ShaderNodeUVMap');uv.uv_map=old_uv
                        for node in list(nodes):
                            if node.type=='TEX_IMAGE' and not node.inputs['Vector'].is_linked:links.new(uv.outputs['UV'],node.inputs['Vector'])
                            if node.type=='NORMAL_MAP' and not node.uv_map:node.uv_map=old_uv
                            if node.type=='TEX_COORD':
                                for link in list(node.outputs['UV'].links):links.new(uv.outputs['UV'],link.to_socket)
                    tex=nodes.new('ShaderNodeTexImage');tex.image=indirect
                    for node in nodes:node.select=False
                    tex.select=True;nodes.active=tex;clones[key]=copy
                obj.data.materials[i]=clones[key]
            obj.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        try:unwrap_objects(objects,resolution,'_detail' in name,padding=4,minimum=6)
        except ValueError as error:
            if 'UV atlas' not in str(error) or len(objects)<2:raise
            midpoint=len(objects)//2
            groups[cursor:cursor]=[(name+'_p0',objects[:midpoint],resolution),(name+'_p1',objects[midpoint:],resolution)]
            bpy.data.images.remove(indirect)
            print('STUDIO_HYBRID split',name,len(objects),flush=True)
            continue
        def bake(kind,target,passes=None,normal_space='TANGENT'):
            for material in clones.values():material.node_tree.nodes.active.image=target
            args={'type':kind,'margin':0,'uv_layer':UV_NAME}
            if passes is not None:args['pass_filter']=passes
            if kind=='NORMAL':args['normal_space']=normal_space
            print('STUDIO_HYBRID bake',name,kind,passes,flush=True)
            with bake_log():bpy.ops.object.bake(**args)
        albedo=new_image('albedo');normal=new_image('normal');roughness=new_image('roughness');guide=new_image('guide',light_resolution)
        scene.cycles.samples=1
        bake('DIFFUSE',albedo,{'COLOR'})
        pixels=np.empty(resolution*resolution*4,dtype=np.float32)
        albedo.pixels.foreach_get(pixels);coverage=pixels.reshape((resolution,resolution,4))[:,:,3]>.5
        if not coverage.any():raise ValueError('Empty lightmap: '+name)
        pad_bake_images([albedo],radius=3,coverage=coverage)
        albedo.pixels.foreach_get(pixels);mask=pixels.reshape((resolution,resolution,4))[:,:,3]>.5
        missing=0;significant=False
        for obj in objects:
            obj.data.calc_loop_triangles();uv=obj.data.uv_layers[UV_NAME].data
            total_area=sum(t.area for t in obj.data.loop_triangles);missing_area=0
            for triangle in obj.data.loop_triangles:
                point=sum((uv[i].uv for i in triangle.loops),uv[triangle.loops[0]].uv*0)/3
                x=min(resolution-1,max(0,int(point.x*resolution)));y=min(resolution-1,max(0,int(point.y*resolution)))
                if not mask[y,x]:missing+=1;missing_area+=triangle.area
            significant|=missing_area>max(total_area*.002,1e-12)
        if significant:
            for image in (indirect,albedo,normal,roughness,guide):bpy.data.images.remove(image)
            if len(objects)<2 or name.count('_p')>=12:raise ValueError('Insufficient texels for small surfaces: '+name)
            midpoint=len(objects)//2
            groups[cursor:cursor]=[(name+'_p0',objects[:midpoint],resolution),(name+'_p1',objects[midpoint:],resolution)]
            print('STUDIO_HYBRID split uncovered surfaces',name,missing,flush=True)
            continue
        scene.cycles.samples=samples
        bake('DIFFUSE',indirect,{'INDIRECT'})
        scene.cycles.samples=1
        bake('NORMAL',normal);bake('ROUGHNESS',roughness);bake('NORMAL',guide,normal_space='OBJECT')
        pad_bake_images([albedo,normal,roughness],radius=6,coverage=coverage)
        pixels=np.empty(light_resolution*light_resolution*4,dtype=np.float32)
        indirect.pixels.foreach_get(pixels);coverage=pixels.reshape((light_resolution,light_resolution,4))[:,:,3]>.5
        guide.pixels.foreach_get(pixels);pixels.reshape((-1,4))[:,:3]=pixels.reshape((-1,4))[:,:3]*2-1;guide.pixels.foreach_set(pixels)
        exr=output/(name+'_linear.exr');save_denoised(indirect,exr,scene,normal=guide,linear=True)
        clean=bpy.data.images.load(str(exr),check_existing=False);clean.colorspace_settings.name='Non-Color'
        clean.pixels.foreach_get(pixels);rgba=pixels.reshape((light_resolution,light_resolution,4));rgba[:,:,3]=coverage
        clean.pixels.foreach_set(rgba.ravel());clean.update()
        pad_bake_images([clean],radius=4,coverage=coverage)
        clean.pixels.foreach_get(pixels);encoded,scale=encode_rgbm(pixels.reshape((light_resolution,light_resolution,4)))
        rgbm=new_image('rgbm',light_resolution);rgbm.pixels.foreach_set(encoded.ravel());rgbm.update()
        def save(image,suffix,color=False):
            path=output/(name+'_'+suffix+'.png')
            width,height=image.size
            values=np.empty(width*height*4,dtype=np.float32);image.pixels.foreach_get(values)
            write_png(path,values.reshape((height,width,4)),color)
            loaded=bpy.data.images.load(str(path),check_existing=False);loaded.colorspace_settings.name='sRGB' if color else 'Non-Color';loaded.pack()
            atlases.append({'name':path.name,'width':width,'height':height,'objects':len(objects),'kind':suffix})
            return loaded
        color_map=save(albedo,'albedo',True);normal_map=save(normal,'normal');rough_map=save(roughness,'roughness');save(rgbm,'indirect')
        material=bpy.data.materials.new('Studio hybrid '+name);material.use_nodes=True
        nodes=material.node_tree.nodes;links=material.node_tree.links;shader=nodes.get('Principled BSDF');shader.inputs['Metallic'].default_value=0
        uv=nodes.new('ShaderNodeUVMap');uv.uv_map=UV_NAME
        def texture(image):
            node=nodes.new('ShaderNodeTexImage');node.image=image;links.new(uv.outputs['UV'],node.inputs['Vector']);return node
        links.new(texture(color_map).outputs['Color'],shader.inputs['Base Color'])
        links.new(texture(rough_map).outputs['Color'],shader.inputs['Roughness'])
        normal_node=nodes.new('ShaderNodeNormalMap');normal_node.uv_map=UV_NAME
        links.new(texture(normal_map).outputs['Color'],normal_node.inputs['Color']);links.new(normal_node.outputs['Normal'],shader.inputs['Normal'])
        maps[material.name]={'path':output/(name+'_indirect.png'),'range':scale}
        replacements.append((objects,material))
        for image in (indirect,albedo,normal,roughness,guide,clean,rgbm):bpy.data.images.remove(image)
        exr.unlink(missing_ok=True)
    # Replace only after ALL atlases saw every neighboring original material.
    apply_receivers(receiver_changes)
    for objects,material in replacements:
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.data.materials.clear();obj.data.materials.append(material)
            for polygon in obj.data.polygons:polygon.material_index=0
            for name in [layer.name for layer in obj.data.uv_layers]:
                if name!=UV_NAME:obj.data.uv_layers.remove(obj.data.uv_layers[name])
            obj['studioHybrid']=True;obj.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        if len(objects)>1:bpy.ops.object.join()
    bpy.ops.object.select_all(action='DESELECT')
    for obj in scene.objects:
        if obj.type=='MESH' and not obj.hide_render or obj==scene.camera:obj.select_set(True)
    path=output/'baked.glb'
    print('STUDIO_HYBRID export',flush=True)
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,use_active_scene=True,export_cameras=True,export_lights=False,export_extras=True,export_animations=False,export_texcoords=True,export_normals=True,export_materials='EXPORT')
    inject_lightmaps(path,maps,lighting)
    data=path.read_bytes()
    if len(data)>48*1024**2:raise ValueError('Hybrid GLB exceeds 48 MiB')
    return {'schema':1,'bakerVersion':7,'hybridVersion':HYBRID_VERSION,'file':'baked.glb','bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),
            'displayReferred':False,'webBake':{'surfaces':len(receivers),'atlases':len(receiver_changes),'resolution':receiver_resolution,
                                            'passes':['direct','indirect','diffuse','glossy'],'view':'active-camera'},
            'lighting':'static-diffuse-and-indirect' if receivers else 'indirect-only','encoding':'RGBM','samples':samples,'atlases':atlases,'coverageThreshold':.002,'pngCompression':'lossless-adaptive',
            'triangles':triangles,'opaqueObjects':len(opaque),'dynamicObjects':[o.name for o in dynamic],
            'seconds':round(time.monotonic()-start,2),'limitations':['Static indirect illumination; rebake after layout changes','Direct area lights and glass are approximated in the browser']}
