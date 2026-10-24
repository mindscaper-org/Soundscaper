/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperAutomationSession } from '../src/soundscaper/editor-automation-session.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand, redoSoundscaperProjectCommand,
	undoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import { evaluateAutomationLaneAtFrameV21 as evaluate, normalizeAutomationLaneV21, type AutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { commitAutomationWriteModeV21, type AutomationWriteModeV21 } from '../src/common/editor/automation-write-mode-v21.ts';
import type { InterpolationShape } from '../src/common/editor/interpolation-curve.ts';

for (const musical of [false, true]) for (const kind of ['linear', 'hold', 'eased', 'bezier'] as const) {
	test(`Touch preserves every outside programme sample of a ${musical ? 'musical' : 'sample'} ${kind} segment`, () => {
		const fixture = createFixture(musical, kind), original = fixture.lane;
		fixture.capture('touch');
		const captured = fixture.lane;
		for (let frame = 0; frame < 24_000; frame += 251) {
			assert.ok(Math.abs(fixture.value(captured, frame) - fixture.value(original, frame)) < 1e-9, `prefix frame${frame}`);
		}
		for (let frame = 48_001; frame < 108_000; frame += 251) {
			assert.ok(Math.abs(fixture.value(captured, frame) - fixture.value(original, frame)) < 1e-9, `suffix frame${frame}`);
		}
		assert.equal(fixture.value(captured, 36_000), .3);
		assert.equal(fixture.value(captured, 48_000), .3);
		assert.equal(fixture.history.undoStack.length, 1);
		fixture.undo(); assert.deepEqual(fixture.lane, original);
		fixture.redo(); assert.deepEqual(fixture.lane, captured);
	});
}

for (const mode of ['trim', 'latch', 'write'] as const) test(`${mode} capture also leaves the unrecorded suffix unchanged`, () => {
	const fixture = createFixture(false, 'eased'), original = fixture.lane;
	fixture.capture(mode);
	assert.ok(Math.abs(fixture.value(fixture.lane, 72_000) - fixture.value(original, 72_000)) < 1e-9);
});

test('cancelling Touch retains the entire original lane and adds no history', () => {
	const fixture = createFixture(true, 'bezier'), original = fixture.lane;
	fixture.capture('touch', true);
	assert.deepEqual(fixture.lane, original); assert.equal(fixture.history.undoStack.length, 0);
});

for (const musical of [false, true]) test(`unrepresentable ${musical ? 'musical' : 'sample'} Bézier shoulders refuse without changing the lane`, () => {
	const fixture = createFixture(musical, 'bezier', true), original = fixture.lane;
	assert.throws(() => fixture.capture('touch'), /canonical|representable/iu);
	assert.deepEqual(fixture.lane, original); assert.equal(fixture.history.undoStack.length, 0);
});

for (const start of [0, 40]) test(`a one-sample Touch at ${start} restores the original held value immediately afterwards`, () => {
	const fixture = createFixture(false, 'linear');
	const lane = normalizeAutomationLaneV21({ ...fixture.lane, points: [{ id: 'held', position: 0, value: 1 }], segments: [] });
	const original = structuredClone(lane);
	const result = commitAutomationWriteModeV21(lane, 'touch', [
		{ id: 'sample', position: start, phase: 'gesture', laneValue: 1, controlValue: .3, trimDelta: 0 },
	]);
	assert.ok(result.capture); assert.equal(fixture.value(result.capture, start), .3);
	assert.equal(fixture.value(result.capture, start + 1), 1);
	if (start) assert.equal(fixture.value(result.capture, start - 1), 1);
	assert.deepEqual(lane, original);
});

for (const wide of [false, true]) test(`a full persisted lane ${wide ? 'can replace its interior without an oversized intermediate document' : 'refuses capture that cannot retain both outside samples within its point cap'}`, () => {
	const fixture = createFixture(false, 'linear');
	const lane = normalizeAutomationLaneV21({ ...fixture.lane,
		points: Array.from({ length: 4096 }, (_, i) => ({ id: `authored-${i}`, position: i * 2, value: .5 })),
		segments: Array.from({ length: 4095 }, () => ({ kind: 'linear' })) });
	const samples = [1000, ...(wide ? [6000] : [])].map((position, i) => ({ id: `capture-${i}`, position,
		phase: 'gesture' as const, laneValue: .5, controlValue: .2, trimDelta: 0 }));
	const commit = () => commitAutomationWriteModeV21(lane, 'touch', samples);
	if (!wide) { assert.throws(commit, /cap|outside anchors/iu); return; }
	const result = commit(); assert.ok(result.capture); assert.ok(result.capture.points.length <= 4096);
	assert.equal(fixture.value(result.capture, 999), .5); assert.equal(fixture.value(result.capture, 6001), .5);
	assert.equal(fixture.value(result.capture, 3000), .2);
});

function createFixture(musical: boolean, kind: InterpolationShape['kind'], arbitraryTime = false) {
	const position = (frame: number) => musical ? { num: frame / 24_000, den: 1 } : frame;
	const shape: InterpolationShape = kind === 'bezier' ? { kind,
		control1: { position: arbitraryTime ? { num: musical ? 1 : 24_000, den: 1 } : { num: musical ? 4 : 32_000, den: musical ? 3 : 1 }, value: .9 },
		control2: { position: arbitraryTime ? { num: musical ? 3 : 72_000, den: 1 } : { num: musical ? 8 : 64_000, den: musical ? 3 : 1 }, value: .6 } } : { kind };
	const project = createSoundscaperProject({ id: 'capture-programme', tracks: [createAudioTrack({ id: 'voice' })],
		automationLanes: [{ id: 'voice-gain', address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
			timebase: musical ? 'musical-beats' : 'absolute-samples',
			points: [{ id: 'start', position: position(0), value: 1 }, { id: 'end', position: position(96_000), value: .2 }], segments: [shape] }] });
	let history = createSoundscaperProjectHistory(project);
	const authority = { projectId: project.id, projectRevision: project.revision, readOnly: false, lockReadOnly: false,
		transportState: 'playing', positionFrame: 24_000, sampleRate: project.sampleRate, tempoMap: project.tempoMap };
	const options = { sampleRate: project.sampleRate, tempoMap: project.tempoMap };
	const session = createSoundscaperAutomationSession({ captureAuthority: () => authority,
		resolveTarget: () => ({ lane: history.present.automationLanes[0]!,
			descriptor: stripParameterDescriptor(history.present.automationLanes[0]!.address), controlValue: 1, locked: false }),
		commit: command => {
			history = executeSoundscaperProjectCommand(history, command as AudioEditorCommand);
			authority.projectRevision = history.present.revision; return history.present;
		} });
	return {
		get lane() { return history.present.automationLanes[0]!; }, get history() { return history; },
		value: (lane: AutomationLaneV21, frame: number) => evaluate(lane, frame, options),
		capture(mode: AutomationWriteModeV21, cancel = false) {
			session.setMode(mode, 'voice-gain');
			const token = session.beginGesture('voice-gain', evaluate(project.automationLanes[0]!, 24_000, options));
			authority.positionFrame = 36_000; session.previewGesture(token, .3);
			authority.positionFrame = 48_000;
			if (cancel) { session.cancelGesture(token); return; }
			session.releaseGesture(token, .3);
			if (mode === 'latch' || mode === 'write') { authority.transportState = 'stopped'; session.synchronize(); }
		},
		undo() { history = undoSoundscaperProjectCommand(history); authority.projectRevision = history.present.revision; },
		redo() { history = redoSoundscaperProjectCommand(history); authority.projectRevision = history.present.revision; },
	};
}
