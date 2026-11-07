"""Read authored lighting roles and bake static diffuse receivers in the assembled scene."""
import re
from pathlib import Path

from bake import UV_NAME, save_denoised, surface_area, unwrap_objects

V06_BLEND = '5dd17152335c1adba5355e3c32d0cf9c616fbbc9fb4baf03111a2584948c1cfa'
ROLES = ('WebBake', 'RoomLights', 'StudioLights')


def read_roles(scene, manifest):
    """Resolve membership before appending/copying objects changes their names."""
    roles = {name: set() for name in ROLES}
    declared = set()
    for collection in [scene.collection, *scene.collection.children_recursive]:
        name = re.sub(r'\.\d{3,}$', '', collection.name)
        if name in roles:
            declared.add(name)
            roles[name].update(collection.all_objects)
    sha = next((a['sha256'] for a in manifest['assets'] if a['name'] == manifest['blend']), None)
    if not declared and sha == V06_BLEND and scene.name.split('.')[0] == '01_Clay_Normal':
        # Immutable pre-convention upload. Only this checked original gets a migration.
        floors = {'Sports_Floor', 'Vintage_Floor', 'Sauna_Floor', 'Supporters_Floor',
                  'V06_Cinema_zone', 'V06_Threshold_stone', 'V06_Straight_running_lane',
                  'V06_Lane_number', 'V06_Track_finish', 'Shared_Sauna_Sports_Wall',
                  'Prayer_Back_Wall', 'Prayer_Left_Wall', 'Vintage_Tshirt_Wall',
                  'Sauna_Left_Wall','Sauna_Back_Wall'}
        for obj in scene.objects:
            name = obj.name.split('.')[0]
            if obj.type == 'MESH' and name in floors:
                roles['WebBake'].add(obj)
            if obj.type == 'LIGHT':
                roles['StudioLights' if name in ('Large_softbox', 'Fill') else 'RoomLights'].add(obj)
        declared.update(ROLES)
    for name, objects in roles.items():
        kind = 'MESH' if name == 'WebBake' else 'LIGHT'
        for obj in objects:
            if obj.type in ('EMPTY', 'CAMERA'):
                continue
            if obj.type != kind:
                raise ValueError(f'{name}: unexpected {obj.type} object {obj.name}')
    both = roles['RoomLights'] & roles['StudioLights']
    if any(obj.type == 'LIGHT' for obj in both):
        raise ValueError('A light belongs to both RoomLights and StudioLights')
    return roles, declared


def receiver_groups(objects):
    """Give large surfaces independent atlases; keep small markings together per module."""
    by_module = {}
    for obj in objects:
        by_module.setdefault(obj.get('studioModule', ''), []).append(obj)
    for members in by_module.values():
        areas = {obj: surface_area(obj) for obj in members}
        limit = max(areas.values()) * .16
        small = []
        for obj in sorted(members, key=lambda o: o.name):
            if areas[obj] >= limit or obj.get('studioBackdrop'):
                yield [obj]
            else:
                small.append(obj)
        for i in range(0, len(small), 32):
            yield small[i:i + 32]


def bake_receivers(scene, objects, output, resolution, samples):
    """Return replacements; leave all original scattering materials in place until commit."""
    import bpy
    import bmesh
    import tempfile
    replacements = []
    scene.cycles.samples = samples
    scene.render.bake.use_selected_to_active = False
    scene.render.bake.use_clear = True
    for batch, group in enumerate(receiver_groups(objects)):
        bpy.ops.object.select_all(action='DESELECT')
        image = bpy.data.images.new('WebBake diffuse', resolution, resolution, alpha=True, float_buffer=True)
        for obj in group:
            # Closed solids in older authored scenes sometimes have inward normals.
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            if all(e.is_manifold for e in bm.edges) and bm.calc_volume(signed=True) < 0:
                bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
                bm.to_mesh(obj.data)
            bm.free()
            layers = obj.data.uv_layers
            original_uv = layers.active.name if layers.active else None
            layer = layers.get(UV_NAME) or layers.new(name=UV_NAME)
            layers.active = layer
            # Keep implicit material UV reads on the artist's original render UV.
            if original_uv:
                layers[original_uv].active_render = True
            if not obj.material_slots:
                raise ValueError('WebBake requires a diffuse material: ' + obj.name)
            for slot in obj.material_slots:
                if not slot.material:
                    raise ValueError('Missing WebBake material: ' + obj.name)
                mat = slot.material.copy()
                slot.material = mat
                if not mat.use_nodes:
                    color = list(mat.diffuse_color)
                    mat.use_nodes = True
                    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = color
                node = mat.node_tree.nodes.new('ShaderNodeTexImage')
                node.image = image
                mat.node_tree.nodes.active = node
            obj.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        unwrap_objects(group, resolution, padding=10)
        print('STUDIO_WEBBAKE', batch, len(group), resolution, samples, flush=True)
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR','DIRECT','INDIRECT'},
                            uv_layer=UV_NAME, margin=8)
        with tempfile.TemporaryDirectory(dir=output) as tmp:
            path = Path(tmp) / f'web-diffuse-{batch}.png'
            save_denoised(image, path, scene)
            tex = bpy.data.images.load(str(path), check_existing=False)
            tex.pack()
        bpy.data.images.remove(image)
        mat = bpy.data.materials.new(f'WebBake diffuse {batch}')
        mat.use_nodes = True
        mat['studioWebBake'] = True
        nodes = mat.node_tree.nodes
        nodes.clear()
        target = nodes.new('ShaderNodeOutputMaterial')
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = tex
        # The Blender glTF exporter recognizes this as KHR_materials_unlit.
        mat.node_tree.links.new(texture.outputs['Color'], target.inputs['Surface'])
        replacements.append((group, mat))
    return replacements


def apply_receivers(replacements):
    for objects, material in replacements:
        for obj in objects:
            layers = obj.data.uv_layers
            for name in [layer.name for layer in layers if layer.name != UV_NAME]:
                layers.remove(layers[name])
            obj.data.materials.clear()
            obj.data.materials.append(material)
            for poly in obj.data.polygons:
                poly.material_index = 0
            obj['studioWebBake'] = True
