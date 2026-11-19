/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import test from 'node:test';
import { createAafExport } from '../src/common/editor/aaf-export.ts';
import { parseAafDocument } from '../src/common/editor/aaf-import.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { createReferenceAaf, withAafReference } from './helpers/aaf-reference.ts';

test('pyaaf2 validates exported AAF objects, native source-rate trims, embedded bytes and timecode', () => {
	const wav = encodeWav([new Float32Array(44_100).fill(.25)], { sampleRate: 44_100, bitDepth: 24 }) as Uint8Array;
	const result = createAafExport({ project: { title: 'Independent', sampleRate: 48_000,
		sources: [{ id: 's', name: 'Voice.wav', sampleRate: 44_100, channelCount: 1, frameCount: 44_100 }],
		clips: [{ id: 'c', kind: 'audio', sourceId: 's', title: 'Phrase', timelineStartFrame: 24_000, durationFrames: 24_000, sourceStartFrame: 11_025 }],
		tracks: [{ id: 't', type: 'audio', name: 'Dialogue', clipIds: ['c'] }],
		primarySequenceId: 'seq', sequences: [{ id: 'seq', rate: { num: 30_000, den: 1_001 }, dropFrame: true, startTimecode: { hours: 1, minutes: 0, seconds: 0, frames: 0 } }],
	}, media: new Map([['s', wav]]) });
	const actual = withAafReference(`
import hashlib
with aaf2.open(sys.argv[1], 'r') as f:
    for mob in f.content.mobs:
        for obj, streams in mob.walk_references():
            obj.validate()
    composition = list(f.content.toplevel())[0]
    slot = composition.slots[0]
    gap, clip = list(slot.segment.components)
    tc = composition.slots[1]
    essence = list(f.content.essencedata)[0]
    print(json.dumps({'name': composition.name, 'track': slot.name, 'rate': str(slot.edit_rate),
        'gap': gap.length, 'length': clip.length, 'start': clip.start, 'sourceRate': str(clip.slot.edit_rate),
        'title': clip['UserComments'][0].value, 'hash': hashlib.sha256(essence.open().read()).hexdigest(),
        'tcRate': str(tc.edit_rate), 'tcStart': tc.segment.start, 'drop': tc.segment['Drop'].value}))
`, (_path, stdout) => JSON.parse(stdout) as Record<string, unknown>, result.bytes);
	assert.deepEqual(actual, { name: 'Independent', track: 'Dialogue', rate: '48000', gap: 24_000, length: 24_000, start: 11_025,
		sourceRate: '44100', title: 'Phrase', hash: createHash('sha256').update(wav).digest('hex'), tcRate: '30000/1001', tcStart: 107_892, drop: true });
});

for (const scenario of ['pcm', 'effect', 'missing', 'legacy']) test(`imports independent ${scenario} AAF through real mob chains`, async () => {
	const document = parseAafDocument(createReferenceAaf(scenario));
	assert.equal(document.title, 'Independent AAF');
	assert.equal(document.tracks[0]!.name, 'Dialogue');
	assert.deepEqual(document.tracks[0]!.clips.map(clip => [clip.start, clip.duration, clip.sourceStart]), [
		[{ num: 1, den: 2 }, { num: 1, den: 2 }, { num: 1, den: 4 }],
	]);
	if (scenario === 'missing') assert.ok(document.issues.some(issue => issue.disposition === 'missing'));
	else {
		const audio = await inspectWavBlobPcm(document.media[0]!.blob);
		assert.equal(audio.frameCount, 44_100); assert.equal(audio.sampleRate, 44_100); assert.equal(audio.channelCount, 1);
		if (scenario === 'effect') assert.ok(document.issues.some(issue => issue.code === 'aaf.effect-omitted'));
	}
});

test('AAF standard dictionary payload matches its recorded source hash', () => {
	const seed = JSON.parse(readFileSync(new URL('../src/common/editor/aaf/standard-dictionary.json', import.meta.url), 'utf8')) as { data: string; payloadSha256: string };
	assert.equal(createHash('sha256').update(inflateSync(Buffer.from(seed.data, 'base64'))).digest('hex'), seed.payloadSha256);
});
