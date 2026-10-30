/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createNativeClipEnvelope, createNativeTrackEnvelopeConverter } from '../src/common/editor/aup4-export-envelopes.js';

test('A17 adaptive native envelope subdivision uses scalar probes', () => {
	const original = Array.prototype.filter;
	let filters = 0;
	Array.prototype.filter = function <T>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown, receiver?: unknown): T[] { filters++; return original.call(this, predicate, receiver) as T[]; };
	try {
		const result = createNativeClipEnvelope({ id: 'clip', durationFrames: 4096, gain: 1, fadeInFrames: 2000, fadeInShape: 1 }, { envelope: [] });
		assert.equal(createHash('sha256').update(JSON.stringify(result)).digest('hex'), 'd61d4df345c5646bc8617f0bd6bcee1841facff6ed7566747d758f0db1a3bf6e');
		assert.ok(filters <= 8, `array filter allocations: ${filters}`);
	} finally { Array.prototype.filter = original; }
});

test('A18 native envelope peak normalization does not spread a point-sized argument list', () => {
	const original = Math.max;
	let maximumArguments = 0;
	Math.max = (...values) => { maximumArguments = original(maximumArguments, values.length); return original(...values); };
	try {
		const envelope = Array.from({ length: 1000 }, (_, frame) => ({ frame, value: frame % 7 }));
		const result = createNativeClipEnvelope({ id: 'clip', durationFrames: 4096, gain: 1, envelope }, { envelope: [] });
		assert.equal(result.pcmGain, 1.5);
		assert.equal(result.points.length, 1000);
		assert.equal(result.points[6]?.value, 4);
		const converted = createNativeClipEnvelope({ id: 'clip', durationFrames: 4096, gain: 2, envelope }, { envelope: [] });
		assert.equal(converted.pcmGain, 3);
		assert.equal(converted.points.find((point: { frame: number }) => point.frame === 6)?.value, 4);
		assert.ok(maximumArguments <= 2, `maximum argument count: ${maximumArguments}`);
	} finally { Math.max = original; }
});

test('A20 export planning normalizes each immutable track envelope once', async () => {
	const { createAup4ExportPlan } = await import('../src/common/editor/aup4-export.js');
	const envelope = Object.freeze(Array.from({ length: 40 }, (_, index) => Object.freeze({ frame: index * 4, value: .5 + index / 100 })));
	const clips = Array.from({ length: 50 }, (_, index) => ({ id: `c${index}`, sourceId: 's', timelineStartFrame: index * 200,
		sourceStartFrame: 0, sourceDurationFrames: 160, durationFrames: 160, trimStartFrames: 0, trimEndFrames: 0, envelope: [] }));
	const project = { id: 'p', title: 'envelope fixture', sampleRate: 48000, selection: { startFrame: 0, endFrame: 0, trackIds: [] }, metadata: {}, master: { effects: [] },
		sources: [{ id: 's', name: 's', storageKey: 's', sampleRate: 48000, originalSampleRate: 48000, channelCount: 1, frameCount: 160, sampleFormat: 'float32', mimeType: 'audio/wav' }],
		clips, tracks: [{ id: 't', type: 'audio', name: 't', clipIds: clips.map(clip => clip.id), effects: [], envelope }] };
	const original = Array.prototype.sort;
	let pointSorts = 0;
	Array.prototype.sort = function <T>(this: T[], compare?: (a: T, b: T) => number): T[] { if (this.length === 40 && typeof this[0] === 'object' && this[0] !== null && 'frame' in this[0]) pointSorts++; return original.call(this, compare) as T[]; };
	try {
		const result = createAup4ExportPlan(project);
		assert.equal(createHash('sha256').update(JSON.stringify(result)).digest('hex'), '8d80c28e1f241fdfb6cc5531894aa0e8923ca539010da36eaf3956fc96f7a9f2');
		assert.ok(pointSorts <= 1, `immutable track point sorts: ${pointSorts}`);
	} finally { Array.prototype.sort = original; }
	let reads = 0;
	const changing = { get envelope() { reads++; return [{ frame: 0, value: reads / 10 }]; } };
	assert.equal(createNativeClipEnvelope({ id: 'c', durationFrames: 4, timelineStartFrame: 0 }, changing).points[0]?.value, .1);
	assert.equal(createNativeClipEnvelope({ id: 'c', durationFrames: 4, timelineStartFrame: 0 }, changing).points[0]?.value, .2);
});

test('prepared track envelopes retain mutable point and replacement behavior', () => {
	const clip = { id: 'c', durationFrames: 4, timelineStartFrame: 0 };
	const point = { frame: 0, value: .2 };
	const track = { envelope: [point] };
	const convert = createNativeTrackEnvelopeConverter(track);
	assert.deepEqual(convert(clip), createNativeClipEnvelope(clip, track));
	point.value = .7;
	assert.deepEqual(convert(clip), createNativeClipEnvelope(clip, track));
	track.envelope = [{ frame: 0, value: .4 }];
	assert.deepEqual(convert(clip), createNativeClipEnvelope(clip, track));
});
