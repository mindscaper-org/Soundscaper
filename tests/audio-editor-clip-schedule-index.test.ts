/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClipSchedulePlans } from '../src/common/editor/engine/clip-schedule-plan.ts';

function fixture() {
	let geometryReads = 0;
	const clips = Array.from({ length: 1000 }, (_, index) => new Proxy(Object.freeze({ id: `clip-${index}`, sourceId: 'audio',
		timelineStartFrame: index * 40, durationFrames: 60, sourceStartFrame: index % 7, sourceDurationFrames: 60 }), {
		get(target, property, receiver) { if (property === 'timelineStartFrame' || property === 'durationFrames') geometryReads++; return Reflect.get(target, property, receiver) as unknown; },
	}));
	const clipIds = clips.map((clip) => clip.id).reverse();
	const track = { id: 'track', type: 'audio', clipIds };
	const project = Object.freeze({ clips: Object.freeze(clips), tracks: Object.freeze([track]) });
	const buffer = { length: 1000, sampleRate: 48000, numberOfChannels: 1, getChannelData: () => new Float32Array(1000) } as unknown as AudioBuffer;
	const input = {} as AudioNode;
	const options = { project, sources: new Map([['audio', buffer]]), trackInputs: new Map([['track', input]]), fromFrame: 491, toFrame: 501, sampleRate: 48000 };
	return { project, track, options, geometryReads: () => geometryReads, reset: () => { geometryReads = 0; } };
}
function comparable(plans: ReturnType<typeof buildClipSchedulePlans>) {
	return plans.map(({ clip, ...plan }) => ({ ...plan, clipId: clip.id }));
}

test('retained schedule geometry avoids complete clip and crossfade preparation on a second narrow render', () => {
	const subject = fixture(); const first = buildClipSchedulePlans(subject.options); subject.reset();
	const second = buildClipSchedulePlans(subject.options);
	assert.deepEqual(comparable(second), comparable(first));
	assert.ok(subject.geometryReads() < 10, `second range read ${subject.geometryReads()} geometry fields`);
	assert.deepEqual(second.map((plan) => plan.clip.id), ['clip-12', 'clip-11']);
	assert.deepEqual(second[0]!.crossfadeInRanges, [[0, 20]]);
});

test('source resolution stays live when immutable schedule geometry is retained', () => {
	const subject = fixture();
	let offset = 70;
	const cached = { ...subject.options, sourceResolver: () => ({ sourceStartFrame: offset }) };
	assert.equal(buildClipSchedulePlans(cached)[0]!.offsetFrame, 81);
	offset = 90; assert.equal(buildClipSchedulePlans(cached)[0]!.offsetFrame, 101);
});

test('indexed windows preserve fresh baseline plans across boundaries and nested overlaps', () => {
	const clips = [
		{ id: 'outer', timelineStartFrame: 0, durationFrames: 400 },
		{ id: 'left', timelineStartFrame: 20, durationFrames: 180 },
		{ id: 'right', timelineStartFrame: 100, durationFrames: 220 },
		{ id: 'same', timelineStartFrame: 100, durationFrames: 220 },
	].map((clip) => Object.freeze({ ...clip, sourceId: 'audio', sourceStartFrame: 0, sourceDurationFrames: Math.max(1, clip.durationFrames) }));
	const track = { id: 'track', type: 'audio', clipIds: Object.freeze(['right', 'left', 'outer', 'same']) };
	const project = Object.freeze({ clips: Object.freeze(clips), tracks: Object.freeze([track]) });
	const sample = fixture().options;
	for (const [fromFrame, toFrame] of [[0, 20], [20, 90], [90, 100], [100, 200], [200, 220], [320, 400], [400, 401]]) {
		const options = { ...sample, fromFrame: fromFrame!, toFrame: toFrame!, project };
		const indexed = buildClipSchedulePlans(options);
		const baseline = buildClipSchedulePlans({ ...options, project: { ...project } });
		assert.deepEqual(indexed, baseline, `${fromFrame}..${toFrame}`);
	}
});
