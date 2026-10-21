"""Create web-sized textures while preserving original assets and GLB geometry/animation."""
import io, json, shutil, struct
from pathlib import Path
from PIL import Image, ImageFile
ImageFile.MAXBLOCK = 64 * 1024 * 1024

ROOT = Path(__file__).resolve().parent.parent
BACKUP = ROOT / '.source-assets'

def original(path):
    backup = BACKUP / path.relative_to(ROOT)
    if not backup.exists():
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, backup)
    return backup

for path in (ROOT / 'assets/green-grass').glob('*.jpg'):
    source = original(path)
    image = Image.open(source)
    if 'Color' not in path.name:
        image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
    quality = 94 if 'Normal' in path.name else 87
    output = io.BytesIO()
    image.save(output, 'JPEG', quality=quality, subsampling=0, optimize=True)
    path.write_bytes(output.getvalue())
    print(path.name, source.stat().st_size, '->', path.stat().st_size)

path = ROOT / 'assets/giraffe/source/Reticulated_Giraffe_Rigged_Animated_v3.glb'
source = original(path).read_bytes()
json_length = struct.unpack_from('<I', source, 12)[0]
doc = json.loads(source[20:20+json_length])
binary = source[28+json_length:]
assert len(doc['buffers']) == 1 and not doc.get('extensionsRequired'), 'Unsupported GLB layout'
replacements = {}
for image in doc['images']:
    view = doc['bufferViews'][image['bufferView']]
    start = view.get('byteOffset', 0)
    raw = binary[start:start+view['byteLength']]
    pixels = Image.open(io.BytesIO(raw))
    name = image.get('name', '')
    limit = 4096 if 'Body_BaseColor' in name else 2048 if 'Body_Normal' in name else 1024
    pixels.thumbnail((limit, limit), Image.Resampling.LANCZOS)
    output = io.BytesIO()
    if image['mimeType'] == 'image/png':
        pixels.save(output, 'PNG', optimize=True)
    else:
        pixels.save(output, 'JPEG', quality=94 if 'Normal' in name else 88, subsampling=0, optimize=True)
    encoded = output.getvalue()
    if pixels.size == Image.open(io.BytesIO(raw)).size and len(encoded) >= len(raw):
        encoded = raw
    replacements[image['bufferView']] = encoded
    print(name, len(raw), '->', len(output.getvalue()), pixels.size)

new_binary = bytearray()
for index, view in enumerate(doc['bufferViews']):
    start = view.get('byteOffset', 0)
    payload = replacements.get(index, binary[start:start+view['byteLength']])
    new_binary.extend(b'\0' * (-len(new_binary) % 4))
    view['byteOffset'] = len(new_binary)
    view['byteLength'] = len(payload)
    new_binary.extend(payload)
doc['buffers'][0]['byteLength'] = len(new_binary)
new_binary.extend(b'\0' * (-len(new_binary) % 4))
new_json = json.dumps(doc, separators=(',', ':'), ensure_ascii=False).encode()
new_json += b' ' * (-len(new_json) % 4)
result = struct.pack('<III', 0x46546C67, 2, 28+len(new_json)+len(new_binary))
result += struct.pack('<II', len(new_json), 0x4E4F534A) + new_json
result += struct.pack('<II', len(new_binary), 0x004E4942) + new_binary
path.write_bytes(result)
print('GLB:', len(source), '->', len(result))
