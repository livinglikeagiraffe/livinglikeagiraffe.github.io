"""Offline mobile variants. Geometry, rigs and animation buffers stay unchanged."""
import io, json, struct, shutil
from pathlib import Path
from PIL import Image, ImageFile
ImageFile.MAXBLOCK = 64 * 1024 * 1024
root = Path(__file__).resolve().parent.parent
assets = root / 'assets'
out = assets / 'mobile'
props = ['old_tyre', 'wooden_crate_01', 'football', 'painted_wooden_bench',
         'wooden_picnic_table', 'barrel_stove', 'wooden_bucket_01', 'folding_wooden_stool', 'wood']

def shrink(raw, limit, png=False):
    image = Image.open(io.BytesIO(raw))
    image.thumbnail((limit, limit), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    if png:
        image.save(buf, 'PNG', optimize=True)
    else:
        image.convert('RGB').save(buf, 'JPEG', quality=87, subsampling=0, optimize=True)
    return buf.getvalue()

for folder in ['green-grass'] + ['props/' + name for name in props]:
    for source in (assets / folder).rglob('*'):
        if not source.is_file():
            continue
        dest = out / source.relative_to(assets)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if source.suffix.lower() in ['.jpg', '.png']:
            limit = 1024 if (folder == 'green-grass' and 'Color' in source.name) or (folder == 'props/wood' and source.stem == 'Diffuse') else 512
            dest.write_bytes(shrink(source.read_bytes(), limit, source.suffix == '.png'))
        else:
            shutil.copy2(source, dest)

for source in (assets / 'giraffe').rglob('*.glb'):
    raw = source.read_bytes()
    length = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20+length])
    binary = raw[28+length:]
    replacements = {}
    for image in doc['images']:
        view = doc['bufferViews'][image['bufferView']]
        start = view.get('byteOffset', 0)
        name = image.get('name', '')
        limit = 1024 if source.parent.name == 'bluemesh' or 'Body_Normal' in name else 512
        if 'Body_BaseColor' in name:
            limit = 2048
        replacements[image['bufferView']] = shrink(binary[start:start+view['byteLength']], limit, image['mimeType'] == 'image/png')
    payload = bytearray()
    for i, view in enumerate(doc['bufferViews']):
        start = view.get('byteOffset', 0)
        part = replacements.get(i, binary[start:start+view['byteLength']])
        payload.extend(b'\0' * (-len(payload) % 4))
        view['byteOffset'] = len(payload)
        view['byteLength'] = len(part)
        payload.extend(part)
    doc['buffers'][0]['byteLength'] = len(payload)
    payload.extend(b'\0' * (-len(payload) % 4))
    header = json.dumps(doc, separators=(',', ':')).encode()
    header += b' ' * (-len(header) % 4)
    result = struct.pack('<III', 0x46546C67, 2, 28+len(header)+len(payload))
    result += struct.pack('<II', len(header), 0x4E4F534A) + header
    result += struct.pack('<II', len(payload), 0x004E4942) + payload
    dest = out / source.relative_to(assets)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(result)
    print(source.name, len(raw), '->', len(result))
