"""Bake the two doorway walls with the v06 Cycles scene open, without saving it."""
import sys
from pathlib import Path
import tempfile

import bmesh
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bake import UV_NAME, unwrap_objects, save_denoised

out = Path(sys.argv[sys.argv.index("--")+1]).resolve()
scene = bpy.data.scenes["01_Clay_Normal"]
bpy.context.window.scene = scene
walls = [scene.objects[name] for name in ("Shared_Sauna_Sports_Wall","Prayer_Back_Wall")]
bpy.ops.object.select_all(action="DESELECT")
image = bpy.data.images.new("Doorway diffuse",1024,1024,alpha=True,float_buffer=True)
deps = bpy.context.evaluated_depsgraph_get()
for wall in walls:
    mesh = bpy.data.meshes.new_from_object(wall.evaluated_get(deps), depsgraph=deps)
    wall.modifiers.clear()
    wall.data = mesh
    # The supplied solids have inward-facing polygons. Trace the diffuse bake
    # from the exterior of these closed volumes, as the camera sees them.
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    layer = mesh.uv_layers.new(name=UV_NAME)
    mesh.uv_layers.active = layer
    for slot in wall.material_slots:
        mat = slot.material.copy()
        slot.material = mat
        node = mat.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = image
        mat.node_tree.nodes.active = node
    wall.select_set(True)
bpy.context.view_layer.objects.active = walls[0]
unwrap_objects(walls,1024,padding=12)
scene.cycles.samples = 256
scene.render.bake.use_selected_to_active = False
bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT","INDIRECT","COLOR"},
                    margin=8,uv_layer=UV_NAME)
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
with tempfile.TemporaryDirectory() as tmp:
    filename = str(Path(tmp)/"wall-light.png")
    save_denoised(image,Path(filename),scene)
    tex = bpy.data.images.load(filename)
    mat = bpy.data.materials.new("Door walls")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    node = nodes.new("ShaderNodeTexImage")
    node.image = tex
    mat.node_tree.links.new(node.outputs["Color"],nodes["Principled BSDF"].inputs["Base Color"])
    for wall in walls:
        for layer in list(wall.data.uv_layers):
            if layer.name != UV_NAME:
                wall.data.uv_layers.remove(layer)
        wall.data.materials.clear()
        wall.data.materials.append(mat)
    bpy.ops.export_scene.gltf(filepath=str(out),export_format="GLB",use_selection=True,use_active_scene=True,
                              export_animations=False,export_lights=False,export_cameras=False)
