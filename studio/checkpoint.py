"""Content-verified local bake checkpoints. Never used as publication evidence."""
import hashlib
import json
import math


class BakeCheckpoint:
    def __init__(self, root, identity):
        self.root = root
        self.path = root/'checkpoint.json'
        self.data = {'identity': identity, 'groups': {}}
        if self.path.exists():
            previous = json.loads(self.path.read_text())
            if previous.get('identity') == identity:
                self.data = previous

    def get(self, group, geometry, suffix):
        record = self.data['groups'].get(group, {})
        if record.get('geometry') != geometry:
            return None
        item = record.get('maps', {}).get(suffix)
        if not item or item['entry']['name'] != group+'_'+suffix+'.png':
            return None
        path = self.root/item['entry']['name']
        if (not path.is_file() or path.is_symlink() or not math.isfinite(item['range']) or item['range'] <= 0 or
                hashlib.sha256(path.read_bytes()).hexdigest() != item['sha256']):
            return None
        return {'path': path, 'range': item['range']}, item['entry']

    def put(self, group, geometry, suffix, image, entry):
        record = self.data['groups'].setdefault(group, {'geometry': geometry, 'maps': {}})
        if record['geometry'] != geometry:
            record = {'geometry': geometry, 'maps': {}}
            self.data['groups'][group] = record
        record['maps'][suffix] = {'range': image['range'], 'entry': entry,
                                 'sha256': hashlib.sha256(image['path'].read_bytes()).hexdigest()}
        temporary = self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps(self.data))
        temporary.replace(self.path)
