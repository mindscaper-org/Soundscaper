# SPDX-License-Identifier: AGPL-3.0-only
"""Reproduce the standard AAF dictionary seed using pinned pyaaf2 (test/build only).

Run after npm run provision:interchange-conformance:
PYTHONPATH=vendor/interchange-conformance python3 scripts/generate-aaf-template.py --check
No Python code or runtime is needed by the application.
"""
import argparse
import base64
import datetime
import hashlib
import json
from pathlib import Path
import uuid
import zlib

import aaf2
from aaf2.auid import AUID

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / 'src/common/editor/aaf/standard-dictionary.json'


def generate():
    with aaf2.open(None, 'w', extensions=False) as file:
        epoch = datetime.datetime(2000, 1, 1)
        file.header['LastModified'].value = epoch
        identification = file.header['IdentificationList'][0]
        for name, value in [('CompanyName', 'Mindscaper'), ('ProductName', 'Soundscaper'),
                            ('ProductVersionString', 'AAF audio profile 1'), ('Platform', 'Portable')]:
            identification[name].value = value
        identification['Date'].value = epoch
        identification['ProductID'].value = AUID('b414d71c-8d52-4f1c-85cd-e2911e66b014')
        identification['GenerationAUID'].value = uuid.UUID(int=1)
        # Establish the weak-reference route used by all component DataDefinitions.
        filler = file.create.Filler('sound', 0)
        datadef = bytes(filler['DataDefinition'].data)
        file.save()
        entries = []
        for parent, storages, streams in file.cfb.walk():
            entries.append([parent.path(), bytes(parent.class_id.bytes_le).hex() if parent.class_id else '00' * 16, None])
            for stream in streams:
                entries.append([stream.path(), '00' * 16, base64.b64encode(stream.open().read()).decode('ascii')])
        entries.sort(key=lambda item: item[0])
        payload = json.dumps(entries, separators=(',', ':'), ensure_ascii=True).encode('utf8')
        result = {'schemaVersion': 1, 'generator': 'pyaaf2 1.7.1 (MIT)',
                  'payloadSha256': hashlib.sha256(payload).hexdigest(),
                  'soundDefinition': datadef.hex(),
                  'data': base64.b64encode(zlib.compress(payload, 9)).decode('ascii')}
        return json.dumps(result, indent='\t') + '\n'


if __name__ == '__main__':
    args = argparse.ArgumentParser()
    args.add_argument('--check', action='store_true')
    options = args.parse_args()
    generated = generate()
    if options.check:
        if json.loads(TARGET.read_text()) != json.loads(generated):
            raise SystemExit('AAF dictionary seed is stale; regenerate with scripts/generate-aaf-template.py')
        print('AAF standard dictionary seed is reproducible.')
    else:
        TARGET.parent.mkdir(parents=True, exist_ok=True)
        TARGET.write_text(generated)
