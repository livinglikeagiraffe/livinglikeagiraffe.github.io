"""Rebuild a pinned grid snapshot from original Blender scenes, then light it once."""
import hashlib
import json
import math
import re
from pathlib import Path


def validate_snapshot(path):
    from render import contained, validate_manifest
    snapshot=json.loads(path.read_text())
    if snapshot.get('schema')!=1 or not re.fullmatch(r'[0-9a-f-]{36}',snapshot.get('id','')):
        raise ValueError('Invalid layout snapshot')
    if hashlib.sha256(snapshot['key'].encode()).hexdigest()!=snapshot['digest']:
        raise ValueError('Layout digest mismatch')
    recipe=json.loads(snapshot['key'])
    if recipe!={k:snapshot[k] for k in ('grid','cells','environment')}:
        raise ValueError('Layout recipe mismatch')
    g=snapshot['grid'];cells=snapshot['cells'];occupied=set()
    for k in ('columns','rows'):
        if type(g[k]) is not int or not 1<=g[k]<=6:raise ValueError('Invalid grid size')
    for k in ('width','depth','gap'):
        if not isinstance(g[k],(int,float)) or not math.isfinite(g[k]):raise ValueError('Invalid cell size')
    if not (1<=g['width']<=200 and 1<=g['depth']<=200 and 0<=g['gap']<=20):raise ValueError('Invalid cell size')
    if not 1<=len(cells)<=6:raise ValueError('Whole-space baking supports 1–6 modules')
    if not re.fullmatch(r'#[0-9a-fA-F]{6}',snapshot['environment']['floor']) or snapshot['environment']['lighting']!='shared-softbox':
        raise ValueError('Invalid shared environment')
    if snapshot['quality'] not in ('preview','original'):raise ValueError('Invalid quality')
    for cell in cells:
        if type(cell['x']) is not int or type(cell['z']) is not int or not 0<=cell['x']<g['columns'] or not 0<=cell['z']<g['rows'] or cell['rotation'] not in (0,90,180,270):raise ValueError('Invalid cell')
        key=(cell['x'],cell['z'])
        if key in occupied:raise ValueError('Overlapping cells')
        occupied.add(key)
    root=path.parents[2];sources={}
    for version in dict.fromkeys(c['versionId'] for c in cells):
        source=snapshot['sources'][version]
        if not re.fullmatch(r'studio/modules/[0-9a-f-]{36}/versions/[0-9a-f-]{36}/manifest\.json',source['manifest']):raise ValueError('Unsafe source manifest')
        manifest_path=contained(root,source['manifest'])
        manifest,blend=validate_manifest(manifest_path)
        if manifest['id']!=version:raise ValueError('Source version mismatch')
        sources[version]={**source,'blend':blend,'manifest':manifest}
    return snapshot,sources


def compose_scene(path):
    import bpy
    from mathutils import Vector, Matrix
    snapshot,sources=validate_snapshot(path)
    common=bpy.data.scenes.new('Whole space')
    common.render.engine='CYCLES';common.cycles.samples=64
    common.render.resolution_x=1600;common.render.resolution_y=1200;common.render.resolution_percentage=100
    common.render.film_transparent=False
    templates={};first=None
    def bounds(objects):
        points=[o.matrix_world@Vector(v) for o in objects for v in o.bound_box]
        return Vector(tuple(min(p[k] for p in points) for k in range(3))),Vector(tuple(max(p[k] for p in points) for k in range(3)))
    for version,source in sources.items():
        with bpy.data.libraries.load(str(source['blend']),link=False) as (available,loaded):
            name=source['scene']
            if not name:
                if len(available.scenes)!=1:raise ValueError('Select a source scene or render this module first: '+version)
                name=available.scenes[0]
            if name not in available.scenes:raise ValueError('Source scene not found: '+name)
            loaded.scenes=[name]
        scene=loaded.scenes[0];bpy.context.window.scene=scene
        if scene.render.engine!='CYCLES':raise ValueError('Whole-space baking supports Cycles source scenes')
        if any(i.source=='FILE' and not i.packed_file for i in bpy.data.images):raise ValueError('Pack external images into every source .blend')
        allowed={entry['blend'].resolve() for entry in sources.values()}
        if any(Path(bpy.path.abspath(lib.filepath)).resolve() not in allowed for lib in bpy.data.libraries):
            raise ValueError('Make external linked libraries local before whole-space baking')
        # Appending a scene may keep its dependent IDs linked to that source.
        # Localize them before copying or baking, without changing the source file.
        bpy.ops.object.make_local(type='ALL')
        meshes=[o for o in scene.objects if o.type=='MESH' and not o.hide_render and o.visible_get()]
        if not meshes or len(meshes)>4000:raise ValueError('Source supports 1–4000 visible meshes')
        if any(o.type in {'VOLUME','CURVE','FONT','META','SURFACE'} and not o.hide_render for o in scene.objects):raise ValueError('Convert non-mesh geometry before composition')
        if any(o.instance_type!='NONE' or any(m.type in {'NODES','PARTICLE_SYSTEM'} for m in o.modifiers) for o in meshes):raise ValueError('Realize procedural instances before composition')
        deps=bpy.context.evaluated_depsgraph_get();frozen=[]
        for obj in meshes:
            evaluated=obj.evaluated_get(deps)
            copy=obj.copy();copy.data=bpy.data.meshes.new_from_object(evaluated,preserve_all_data_layers=True,depsgraph=deps)
            matrix=evaluated.matrix_world.copy();copy.parent=None;copy.constraints.clear();copy.animation_data_clear();copy.modifiers.clear();copy.matrix_world=matrix
            frozen.append(copy)
        backdrop=max(frozen,key=lambda o:o.dimensions.x*o.dimensions.y)
        others=[o for o in frozen if o!=backdrop];low,high=bounds(others or frozen);span=max(high.x-low.x,high.y-low.y,1)
        if backdrop.dimensions.z<span*.04 and backdrop.dimensions.x>span*3 and backdrop.dimensions.y>span*3:
            frozen.remove(backdrop)
        low,high=bounds(frozen)
        lights=[o for o in scene.objects if o.type=='LIGHT' and not o.hide_render]
        studio_lights=[o for o in lights if o.data.type in {'AREA','SUN'} and (o.data.type=='SUN' or o.data.size>span*.2)]
        local=[o for o in lights if o not in studio_lights]
        templates[version]={'meshes':frozen,'low':low,'high':high,'local':local,'scene':scene}
        if first is None:first={'scene':scene,'low':low,'high':high,'span':span,'lights':studio_lights}
    source=first['scene']
    common.world=source.world.copy() if source.world else bpy.data.worlds.new('Shared world')
    for prop in ('view_transform','look','exposure','gamma'):
        setattr(common.view_settings,prop,getattr(source.view_settings,prop))
    g=snapshot['grid'];placements=[]
    for cell in snapshot['cells']:
        template=templates[cell['versionId']];low,high=template['low'],template['high'];size=high-low;center=(low+high)*.5
        swap=cell['rotation']%180!=0
        scale=min(1,g['width']*.96/max(size.y if swap else size.x,.001),g['depth']*.96/max(size.x if swap else size.y,.001))
        x=(cell['x']-(g['columns']-1)/2)*(g['width']+g['gap'])
        y=-(cell['z']-(g['rows']-1)/2)*(g['depth']+g['gap'])
        matrix=Matrix.Translation((x,y,0))@Matrix.Rotation(math.radians(cell['rotation']),4,'Z')@Matrix.Scale(scale,4)@Matrix.Translation((-center.x,-center.y,-low.z))
        group=f"module_{cell['x']}_{cell['z']}"
        for original in template['meshes']+template['local']:
            obj=original.copy();world=original.matrix_world.copy();obj.parent=None;obj.constraints.clear();obj.animation_data_clear();obj.matrix_world=matrix@world
            obj.name=group+'_'+original.name;obj.hide_select=False;obj.hide_viewport=False;obj['studioModule']=group
            if obj.type=='LIGHT':obj.data=original.data.copy();obj.data.energy*=scale*scale
            common.collection.objects.link(obj)
        placements.append({**cell,'scale':scale,'position':[x,0,-y],'sourceBounds':[list(low),list(high)]})
    bpy.context.window.scene=common;bpy.context.view_layer.update()
    module_meshes=[o for o in common.objects if o.type=='MESH'];low,high=bounds(module_meshes)
    width=g['columns']*g['width']+(g['columns']-1)*g['gap'];depth=g['rows']*g['depth']+(g['rows']-1)*g['gap'];span=max(width,depth,high.z,1)
    ratio=span/first['span'];source_center=(first['low']+first['high'])*.5
    for original in first['lights']:
        light=original.copy();light.data=original.data.copy();matrix=original.matrix_world.copy();light.parent=None;light.constraints.clear();light.animation_data_clear()
        matrix.translation=(matrix.translation-Vector((source_center.x,source_center.y,first['low'].z)))*ratio
        light.matrix_world=matrix
        if light.data.type=='AREA':light.data.size*=ratio;light.data.size_y*=ratio;light.data.energy*=ratio*ratio
        common.collection.objects.link(light)
    if not first['lights']:
        for i,(position,energy,size) in enumerate([((.35,-.3,.9),7,.65),((-.5,.2,.65),4,.5)]):
            light=bpy.data.objects.new('Shared softbox '+str(i),bpy.data.lights.new('Shared softbox '+str(i),'AREA'))
            light.location=Vector(position)*span;light.rotation_euler=(-light.location).to_track_quat('-Z','Y').to_euler();light.data.energy=span*span*energy;light.data.size=span*size;common.collection.objects.link(light)
    # One continuous floor. No per-cell plinths or independent shadow catchers.
    mesh=bpy.data.meshes.new('Continuous floor');radius=span*2.5;mesh.from_pydata([(-radius,-radius,-.035),(radius,-radius,-.035),(radius,radius,-.035),(-radius,radius,-.035)],[],[(0,1,2,3)]);mesh.update()
    floor=bpy.data.objects.new('Shared floor',mesh);floor['studioBackdrop']=True;floor['studioKeepBackdrop']=True;common.collection.objects.link(floor)
    mat=bpy.data.materials.new('Shared floor material');mat.use_nodes=True
    color=snapshot['environment']['floor'];srgb=[int(color[i:i+2],16)/255 for i in (1,3,5)];linear=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in srgb]
    shader=mat.node_tree.nodes.get('Principled BSDF');shader.inputs['Base Color'].default_value=(*linear,1);shader.inputs['Roughness'].default_value=.9;mesh.materials.append(mat)
    camera=bpy.data.objects.new('Whole space camera',bpy.data.cameras.new('Whole space camera'));common.collection.objects.link(camera);common.camera=camera;camera.data.type='ORTHO';camera.data.clip_end=span*20
    direction=Vector((1,-1,1))
    if source.camera:direction=source.camera.matrix_world.to_quaternion()@Vector((0,0,1))
    camera.location=direction.normalized()*span*3;camera.rotation_euler=(-camera.location).to_track_quat('-Z','Y').to_euler()
    inverse=camera.rotation_euler.to_matrix().transposed()
    points=[inverse@Vector((x,y,z)) for x in (-width/2,width/2) for y in (-depth/2,depth/2) for z in (0,high.z)]
    camera.data.ortho_scale=max(max(p.x for p in points)-min(p.x for p in points),(max(p.y for p in points)-min(p.y for p in points))*4/3)*1.22
    bpy.context.view_layer.update()
    return common,{'schema':1,'id':snapshot['id'],'moduleId':'layout'}, {'layoutId':snapshot['id'],'layoutDigest':snapshot['digest'],'layout':{k:snapshot[k] for k in ('grid','cells','environment')},'placements':placements,'sharedFloor':floor.name,'sharedLights':[o.name for o in common.objects if o.type=='LIGHT' and not o.get('studioModule')]}
