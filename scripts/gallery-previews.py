"""Create small previews and reading-size images; keep originals for the viewer."""
from pathlib import Path
from PIL import Image, ImageOps
import json, subprocess

root = Path(__file__).resolve().parent.parent
manifest = root / 'assets/projects/posts.json'
posts = json.loads(manifest.read_text())
total = 0
for post in posts.values():
    for media in post['media']:
        source = Path(media.get('poster', media['src']))
        image = ImageOps.exif_transpose(Image.open(root / source)).convert('RGB')
        if media['type'] == 'video':
            streams = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'json', str(root / media['src'])]))['streams']
            video = next(s for s in streams if s['codec_type'] == 'video')
            media['width'], media['height'] = video['width'], video['height']
            media['hasAudio'] = any(s['codec_type'] == 'audio' for s in streams)
        else:
            media['width'], media['height'] = image.size
        for key, edge, quality in [('preview', 160, 65), ('display', 960, 82)]:
            dest = Path('assets/projects/previews') / source.parent.name / f'{source.stem}-{key}.jpg'
            (root / dest).parent.mkdir(parents=True, exist_ok=True)
            pixels = image.copy()
            pixels.thumbnail((edge, edge), Image.Resampling.LANCZOS)
            pixels.save(root / dest, 'JPEG', quality=quality, optimize=True)
            media[key] = dest.as_posix()
            total += (root / dest).stat().st_size
manifest.write_text(json.dumps(posts, ensure_ascii=False, indent=2) + '\n')
print(f'Gallery preview + display images: {total / 1048576:.2f} MiB')
