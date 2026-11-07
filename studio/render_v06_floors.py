"""Run in Blender with riraji_full.blend open. The source .blend is never saved."""
import bpy
from pathlib import Path
import sys

output = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
scene = bpy.data.scenes["01_Clay_Normal"]
bpy.context.window.scene = scene
# Camera visibility alone changes. Walls still block light and the chairs still
# cast shadows and participate in diffuse bounces in the original scene.
receivers = {"Supporters_Floor", "Sauna_Floor", "Sports_Floor", "Vintage_Floor",
             "V06_Cinema_zone", "V06_Threshold_stone"}
for obj in scene.objects:
    if obj.type in {"MESH", "CURVE", "FONT", "SURFACE"}:
        obj.visible_camera = obj.name.split(".")[0] in receivers

camera = bpy.data.cameras.new("Floor lighting")
probe = bpy.data.objects.new("Floor lighting", camera)
scene.collection.objects.link(probe)
probe.location = (24, 32, 80)
probe.rotation_euler = (0, 0, 0)
camera.type = "ORTHO"
camera.ortho_scale = 48
scene.camera = probe
scene.render.engine = "CYCLES"
scene.cycles.samples = 128
scene.cycles.use_denoising = True
scene.render.resolution_x = 1536
scene.render.resolution_y = 1024
scene.render.resolution_percentage = 100
scene.render.use_border = False
scene.render.use_compositing = False
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
scene.render.image_settings.color_depth = "8"
scene.render.filepath = str(output)
bpy.ops.render.render(write_still=True)
