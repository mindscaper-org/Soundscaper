import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createTrackAutomationTargetInventoryV21 } from '../src/common/editor/track-automation-targets-v21.ts';
import { evaluateAutomationLaneAtFrameV21 } from '../src/common/editor/automation-lane-v21.ts';
import { projectTrackAutomationOverlayV21 } from '../src/common/editor/ui/timeline/track-automation-overlay-projection.ts';

const TRACKS = 8, POINTS = 256;
const DENSE_PROJECT = createSoundscaperProject({ id: 'automation-validation-work',
	tracks: Array.from({ length: TRACKS }, (_, index) => ({ id: `track-${index}`, clipIds: [] })),
	automationLanes: Array.from({ length: TRACKS }, (_, index) => ({ id: `lane-${index}`,
		address: { kind: 'strip', strip: { kind: 'track', id: `track-${index}` }, parameterId: 'gain' }, timebase: 'absolute-samples',
		points: Array.from({ length: POINTS }, (_, point) => ({ id: `point-${point}`, position: point * 48, value: point % 2 ? .8 : .5 })),
		segments: Array.from({ length: POINTS - 1 }, () => ({ kind: 'linear' })) })) });

test('public project validation admits each external automation curve once before descriptor checks', () => {
	let reads = 0;
	const original = Object.getOwnPropertyDescriptor;
	Object.getOwnPropertyDescriptor = (value: object, key: PropertyKey) => {
		if (key === 'position' && value && Object.hasOwn(value, 'value') && Object.hasOwn(value, 'id')) reads++;
		return original(value, key);
	};
	try {
		assert.equal(validateSoundscaperProject(DENSE_PROJECT), true);
		assert.ok(reads <= TRACKS * POINTS * 4, `${reads} point position descriptor reads`);
	} finally { Object.getOwnPropertyDescriptor = original; }
});

test('automation descriptor reuse preserves public malformed-value and missing-owner refusals', () => {
	type MutableLane = { points: { value: number }[]; address: { strip: { id: string } } };
	for (const [mutate, expected] of [
		[(lane: MutableLane) => { lane.points[0]!.value = 99; }, RangeError],
		[(lane: MutableLane) => { lane.points[0]!.value = Infinity; }, TypeError],
		[(lane: MutableLane) => { lane.address.strip.id = 'missing'; }, ReferenceError],
	] as const) {
		const project = structuredClone(DENSE_PROJECT) as unknown as { automationLanes: MutableLane[] };
		mutate(project.automationLanes[0]!);
		assert.throws(() => validateSoundscaperProject(project), expected);
	}
});

test('musical viewport projection prepares tempo evaluation once and keeps every sample value', () => {
	const count = 64, sampleRate = 48_000;
	const project = createSoundscaperProject({ id: 'musical-overlay-work',
		tempoMap: { mode: 'musical', events: Array.from({ length: count }, (_, index) => ({ id: `tempo-${index}`,
			beat: { num: index, den: count }, bpm: { num: index % 2 ? 125 : 120, den: 1 } })) },
		sources: [{ id: 'source', storageKey: 'source', frameCount: sampleRate, channelCount: 1, sampleRate }],
		tracks: [{ id: 'voice', clipIds: ['clip'] }], clips: [{ id: 'clip', sourceId: 'source', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: sampleRate, durationFrames: sampleRate }],
		automationLanes: [{ id: 'pan', address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'pan' },
			timebase: 'musical-beats', points: [{ id: 'low', position: { num: 0, den: 1 }, value: -.5 },
				{ id: 'high', position: { num: 1, den: 1 }, value: .5 }], segments: [{ kind: 'linear' }] }] });
	const target = createTrackAutomationTargetInventoryV21(project, 'voice').find(target => target.descriptor.address.parameterId === 'pan');
	assert.ok(target?.lane);
	const clips = resolveRuntimeProjectProjection(project).clips;
	const original = Array.prototype.entries;
	let preparations = 0;
	Array.prototype.entries = function<T>(this: T[]): ArrayIterator<[number, T]> {
		if (this === project.tempoMap.events) preparations++;
		return Reflect.apply(original, this, []) as ArrayIterator<[number, T]>;
	};
	let projection: ReturnType<typeof projectTrackAutomationOverlayV21>;
	try {
		projection = projectTrackAutomationOverlayV21({ descriptor: target.descriptor, lane: target.lane, currentValue: target.currentValue,
			clips, viewportStartFrame: 0, viewportEndFrame: sampleRate, pixelsPerSecond: 400,
			sampleRate, width: 412, height: 114, tempoMap: project.tempoMap });
		assert.ok(preparations <= 8, `${preparations} complete tempo preparations for one viewport`);
	} finally { Array.prototype.entries = original; }
	assert.equal(projection.spans.length, 1);
	assert.ok(projection.spans[0]!.samples.length >= 200);
	for (const sample of projection.spans[0]!.samples) {
		assert.equal(sample.value, evaluateAutomationLaneAtFrameV21(target.lane, sample.frame, { sampleRate, tempoMap: project.tempoMap }));
	}
});
