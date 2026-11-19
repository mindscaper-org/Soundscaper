/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAafExport } from '../src/common/editor/aaf-export.ts';
import { parseAafDocument } from '../src/common/editor/aaf-import.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { AafObjectWriter } from '../src/common/editor/aaf-object-writer.ts';

function project() {
	return { title: 'Sound edit', sampleRate: 48_000,
		sources: [{ id: 'a', kind: 'audio', name: 'Dialogue.wav', frameCount: 48_000, sampleRate: 48_000, channelCount: 2 }],
		clips: [{ id: 'one', kind: 'audio', sourceId: 'a', timelineStartFrame: 48_000, sourceStartFrame: 12_000, durationFrames: 24_000 },
			{ id: 'two', kind: 'audio', sourceId: 'a', timelineStartFrame: 144_000, sourceStartFrame: 24_000, durationFrames: 24_000 }],
		tracks: [{ id: 'track', type: 'audio', name: 'Dialogue', clipIds: ['one', 'two'] }],
		primarySequenceId: 'seq', sequences: [{ id: 'seq', name: 'Programme', rate: { num: 30_000, den: 1_001 }, dropFrame: true,
			startTimecode: { hours: 1, minutes: 0, seconds: 0, frames: 0 } }] };
}

test('AAF preserves cut placement, source trims, track names, linked media and exact sequence clock', () => {
	const result = createAafExport({ project: project() });
	assert.equal(result.fileName, 'Sound-edit.aaf');
	assert.deepEqual([...result.bytes.subarray(0, 8)], [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
	const imported = parseAafDocument(result.bytes);
	assert.equal(imported.title, 'Sound edit');
	assert.equal(imported.tracks[0]!.name, 'Dialogue');
	assert.deepEqual(imported.tracks[0]!.clips.map(clip => [clip.start, clip.duration, clip.sourceStart]), [
		[{ num: 1, den: 1 }, { num: 1, den: 2 }, { num: 1, den: 4 }],
		[{ num: 3, den: 1 }, { num: 1, den: 2 }, { num: 1, den: 2 }],
	]);
	assert.equal(imported.media[0]!.path, 'Dialogue.wav');
	assert.deepEqual(imported.rate, { num: 30_000, den: 1_001 });
	assert.equal(imported.startFrameCount, 107_892);
	assert.equal(imported.dropFrame, true);
});

test('AAF embeds playable whole-source PCM without exposing storage keys', async () => {
	const wav = encodeWav([new Float32Array(48_000).fill(.25), new Float32Array(48_000).fill(-.25)], { sampleRate: 48_000, bitDepth: 24 }) as Uint8Array;
	const result = createAafExport({ project: project(), media: new Map([['a', wav]]) });
	const imported = parseAafDocument(result.bytes);
	assert.deepEqual(new Uint8Array(await imported.media[0]!.blob!.arrayBuffer()), wav);
	assert.ok(result.report.items.some(item => item.code === 'aaf.sample-format-converted'));
});

test('AAF preserves overlaps on separate tracks and reports omitted processing and picture', () => {
	const p = project(); p.clips[1]!.timelineStartFrame = 60_000;
	const result = createAafExport({ project: { ...p, tracks: [{ ...p.tracks[0], gain: .5 }, { id: 'picture', type: 'video', clipIds: ['v'] }] } });
	assert.equal(parseAafDocument(result.bytes).tracks.length, 2);
	for (const code of ['overlapping-track-split', 'track-processing-omitted', 'track-kind-omitted']) {
		assert.ok(result.report.items.some(item => item.code === `aaf.${code}`), code);
	}
});

test('AAF refuses invalid timing, truncated containers and mismatched embedded PCM', () => {
	const p = project(); p.clips[0]!.durationFrames = -1;
	assert.throws(() => createAafExport({ project: p }), /duration/iu);
	assert.throws(() => parseAafDocument(new Uint8Array(512)), /compound|AAF/iu);
	const result = createAafExport({ project: project() });
	assert.throws(() => parseAafDocument(result.bytes.subarray(0, 512)), /compound|sector|AAF/iu);
	const mono = encodeWav([new Float32Array(48_000)], { sampleRate: 48_000 }) as Uint8Array;
	assert.throws(() => createAafExport({ project: project(), media: new Map([['a', mono]]) }), /geometry/iu);
});

test('AAF rejects cyclic allocation tables and semantic source chains within bounded traversal', () => {
	const bytes = createAafExport({ project: project() }).bytes, view = new DataView(bytes.buffer);
	const sectorSize = 2 ** view.getUint16(30, true), directory = view.getUint32(48, true), fat = view.getUint32(76, true);
	view.setUint32((fat + 1) * sectorSize + directory * 4, directory, true);
	assert.throws(() => parseAafDocument(bytes), /cyclic/iu);
	const writer = new AafObjectWriter(), composition = writer.mob(0x35, 'Cycle');
	composition.refs(0x4403, [writer.slot(writer.sourceClip(48_000, composition), 48_000, 1, 'Cycle')]);
	writer.content.refs(0x1901, [composition], 0x4401);
	assert.throws(() => parseAafDocument(writer.finish()), /traversal/iu);
});
