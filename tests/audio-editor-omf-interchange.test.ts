/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createOmfExport } from '../src/common/editor/omf-export.ts';
import { parseOmfDocument } from '../src/common/editor/omf-import.ts';
import { readOmfBento } from '../src/common/editor/omf-bento.ts';
import { OmfObjectWriter, omfWaveSummary } from '../src/common/editor/omf-object-writer.ts';

function project(overrides: Record<string, unknown> = {}) {
	return { title: 'Sound edit', sampleRate: 48_000,
		sources: [{ id: 'a', kind: 'audio', name: 'Dialogue.wav', frameCount: 480_000, sampleRate: 48_000, channelCount: 2 }],
		clips: [{ id: 'one', kind: 'audio', sourceId: 'a', title: 'First cut', timelineStartFrame: 48_000, sourceStartFrame: 96_000, durationFrames: 48_000 },
			{ id: 'two', kind: 'audio', sourceId: 'a', title: 'Second cut', timelineStartFrame: 144_000, sourceStartFrame: 192_000, durationFrames: 48_000 }],
		tracks: [{ id: 'track', type: 'audio', name: 'Dialogue', clipIds: ['one', 'two'] }], ...overrides };
}

test('OMF2 exports standard mobs, linked WAV media, sample positions and gaps', () => {
	const result = createOmfExport({ project: project() });
	assert.equal(result.fileName, 'Sound-edit.omf');
	const bento = readOmfBento(result.bytes);
	assert.equal(bento.text(1, 'OMFI:OOBJ:ObjClass'), 'HEAD');
	assert.deepEqual([...bento.value(1, 'OMFI:HEAD:Version')!], [2, 0]);
	assert.ok(bento.objects.some((id) => bento.text(id, 'OMFI:OOBJ:ObjClass') === 'CMOB'));
	assert.ok(bento.objects.some((id) => bento.text(id, 'OMFI:OOBJ:ObjClass') === 'WAVD'));
	const imported = parseOmfDocument(result.bytes);
	assert.equal(imported.title, 'Sound edit');
	assert.equal(imported.sampleRate, 48_000);
	assert.deepEqual(imported.media.map((media) => media.path), ['Dialogue.wav']);
	assert.deepEqual(imported.tracks[0]?.clips.map((clip) => [clip.name, clip.start.num / clip.start.den, clip.duration.num / clip.duration.den, clip.sourceStart.num / clip.sourceStart.den]),
		[['First cut', 1, 1, 2], ['Second cut', 3, 1, 4]]);
});

test('OMF2 splits overlapping clips into separate standard timeline slots', () => {
	const p = project(); p.clips[1]!.timelineStartFrame = 72_000;
	const result = createOmfExport({ project: p });
	const imported = parseOmfDocument(result.bytes);
	assert.equal(imported.tracks.length, 2);
	assert.equal(result.report.items.some((item) => item.code === 'omf.overlapping-track-split'), true);
});

test('OMF2 reports MIDI authoring conversion and unsupported picture tracks', () => {
	const p = project();
	const result = createOmfExport({ project: { ...p, clips: p.clips.map((clip) => ({ ...clip, midi: { notes: [{ pitch: 60 }] } })),
		tracks: [...p.tracks, { id: 'v', type: 'video', name: 'Picture', clipIds: ['video'] }] } });
	assert.ok(result.report.items.some((item) => item.code === 'omf.midi-authoring-converted'));
	assert.ok(result.report.items.some((item) => item.code === 'omf.track-kind-omitted'));
});

test('OMF2 rejects invalid sample timing before producing bytes', () => {
	assert.throws(() => createOmfExport({ project: project({ sampleRate: 0 }) }), /sample rate/u);
	const p = project(); p.clips[0]!.durationFrames = -1;
	assert.throws(() => createOmfExport({ project: p }), /duration/u);
});

test('OMF2 embeds a whole WAV body and restores it as importable media', async () => {
	const body = new Uint8Array(44 + 480_000 * 2 * 4); body.set(omfWaveSummary(48_000, 2, 480_000));
	body[100] = 42;
	const result = createOmfExport({ project: project(), media: new Map([['a', body]]) });
	const bento = readOmfBento(result.bytes);
	assert.equal(bento.refs(1, 'OMFI:HEAD:MediaData', true).length, 1);
	const imported = parseOmfDocument(result.bytes), blob = imported.media[0]?.blob;
	assert.ok(blob);
	assert.equal(blob.type, 'audio/wav');
	assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), body);
	assert.deepEqual(imported.tracks[0]?.clips[0]?.sourceStart, { num: 2, den: 1 });
});

test('OMF2 refuses embedded WAV geometry that differs from the timeline source', () => {
	const body = new Uint8Array(44 + 480_000 * 4); body.set(omfWaveSummary(48_000, 1, 480_000));
	assert.throws(() => createOmfExport({ project: project(), media: new Map([['a', body]]) }), /geometry/u);
});

test('OMF2 gives different exports distinct MobIDs', () => {
	const first = readOmfBento(createOmfExport({ project: project() }).bytes), second = readOmfBento(createOmfExport({ project: project() }).bytes);
	const firstMob = first.refs(1, 'OMFI:HEAD:PrimaryMobs', true)[0]!, secondMob = second.refs(1, 'OMFI:HEAD:PrimaryMobs', true)[0]!;
	assert.notDeepEqual(first.value(firstMob, 'OMFI:MOBJ:MobID'), second.value(secondMob, 'OMFI:MOBJ:MobID'));
});

test('OMF2 preserves exact sequence rate, start timecode and drop-frame policy', () => {
	const result = createOmfExport({ project: project({ primarySequenceId: 'seq', sequences: [{ id: 'seq', name: 'Programme', rate: { num: 30_000, den: 1_001 }, dropFrame: true,
		startTimecode: { hours: 1, minutes: 0, seconds: 0, frames: 0 } }] }) });
	const imported = parseOmfDocument(result.bytes);
	assert.deepEqual(imported.rate, { num: 30_000, den: 1_001 });
	assert.equal(imported.startFrameCount, 107_892);
	assert.equal(imported.dropFrame, true);
	assert.equal(imported.tracks.length, 1);
});

test('OMF2 reports quantization of float source PCM into embedded 24-bit WAV', () => {
	const body = new Uint8Array(44 + 480_000 * 2 * 3); body.set(omfWaveSummary(48_000, 2, 480_000, 'int24'));
	const result = createOmfExport({ project: project(), media: new Map([['a', body]]) });
	assert.ok(result.report.items.some((item) => item.code === 'omf.sample-format-converted' && item.data.to === 'int24'));
});

test('OMF2 refuses a cyclic composition graph within its traversal bound', () => {
	const writer = new OmfObjectWriter(), head = writer.object('HEAD', 1), kind = writer.object('DDEF');
	writer.raw(head, 'HEAD:Version', 'VersionType', Uint8Array.of(2, 0));
	writer.text(kind, 'DDEF:DataKindID', 'omfi:data:Sound', 'UniqueName');
	const composition = writer.mob('CMOB', 'Cyclic fixture'), sequence = writer.component('SEQU', kind, 48_000);
	writer.ref(sequence, 'SEQU:Components', [sequence], true);
	writer.ref(composition, 'MOBJ:Slots', [writer.slot(sequence, 48_000, 1, 'Cycle')], true);
	writer.ref(head, 'HEAD:Mobs', [composition], true);
	assert.throws(() => parseOmfDocument(writer.finish()), /traversal/u);
});
