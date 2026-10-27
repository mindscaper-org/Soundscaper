/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipSourceStretchPlan } from '../src/common/editor/ui/inspector/clip-source-stretch-feedback.ts';

const project = { sampleRate: 48000, tempoMap: { mode: 'musical' as const, events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] } };
test('prepared marker positions and adjacent speed labels do not revalidate the warp catalog per marker', () => {
	const points = Array.from({ length: 1000 }, (_, i) => ({ outer: i * 48, source: { num: i, den: 4 }, mode: 'forward' }));
	const clip = { kind: 'audio', anchor: 'sample', timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 250, durationFrames: 48000, warpMap: { feature: 'audio-warp', points } };
	const original = Object.getOwnPropertyDescriptor;
	let reads = 0;
	const pointSet = new Set<unknown>(points);
	Object.getOwnPropertyDescriptor = (value, key) => { if (pointSet.has(value)) reads++; return original(value, key); };
	try {
		const plan = createClipSourceStretchPlan(project, clip, { sampleRate: 12000, frameCount: 250 });
		const initial = reads;
		for (let i = 1; i < 999; i++) {
			const feedback = plan.feedback(i);
			assert.equal(feedback?.displayFrame, i * 48);
			assert.ok(Number.isFinite(feedback?.beforeSpeed));
		}
		assert.equal(reads, initial);
		assert.ok(initial < points.length * 10);
	} finally { Object.getOwnPropertyDescriptor = original; }
});
