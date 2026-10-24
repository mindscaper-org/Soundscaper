/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperAutomationSession, type SoundscaperAutomationPreview } from '../src/soundscaper/editor-automation-session.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand, redoSoundscaperProjectCommand,
	undoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { stripParameterDescriptor } from '../src/common/editor/effect-parameter-descriptors.ts';
import { evaluateAutomationLaneAtFrameV21 as evaluate, type AutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

for (const transportState of ['playing', 'recording']) test(`choosing Write during ${transportState} immediately owns and records the control`, () => {
	const f = fixture();
	f.authority.transportState = transportState;
	f.authority.positionFrame = 100;
	f.session.synchronize();
	const original = f.lane();
	const snapshot = f.session.setMode('write', 'voice-gain');
	assert.equal(snapshot.active, true);
	assert.equal(snapshot.capturePointCount, 1);
	assert.deepEqual(f.previews.at(-1), { laneId: 'voice-gain', mode: 'write', phase: 'readback',
		owner: 'control', capture: true, frame: 100, value: 1 });
	f.move(200);
	f.stop();
	const captured = f.lane();
	assert.equal(valueAt(captured, 99), .2);
	assert.equal(valueAt(captured, 150), 1);
	assert.equal(valueAt(captured, 200), 1);
	assert.equal(valueAt(captured, 201), .2);
	assert.equal(f.history.undoStack.length, 1);
	f.undo(); assert.deepEqual(f.lane(), original);
	f.redo(); assert.deepEqual(f.lane(), captured);
});

test('Write armed before Play still starts at the first transport frame', () => {
	const f = fixture();
	assert.equal(f.session.setMode('write', 'voice-gain').active, false);
	f.authority.transportState = 'playing'; f.move(100);
	assert.equal(f.session.getSnapshot().capturePointCount, 1);
	f.move(200); f.stop();
	assert.equal(valueAt(f.lane(), 150), 1);
	assert.equal(f.history.undoStack.length, 1);
});

test('starting Write before the first transport notification retains its first sample', () => {
	const f = fixture();
	f.authority.transportState = 'playing'; f.authority.positionFrame = 100;
	const started = f.session.setMode('write', 'voice-gain');
	f.move(200);
	assert.equal(f.session.getSnapshot().generation, started.generation);
	assert.equal(f.session.getSnapshot().capturePointCount, 2);
	f.stop(); assert.equal(valueAt(f.lane(), 100), 1);
});

test('reselecting the current Write target retains the active capture and its generation', () => {
	const f = fixture(); f.authority.transportState = 'playing'; f.move(100);
	const started = f.session.setMode('write', 'voice-gain');
	f.move(200);
	const repeated = f.session.setMode('write', 'voice-gain');
	assert.equal(repeated.generation, started.generation);
	assert.equal(repeated.capturePointCount, 2);
	assert.equal(f.history.undoStack.length, 0);
	f.stop(); assert.equal(f.history.undoStack.length, 1);
});

test('changing Write target during Play commits the old lane and captures the new revision', () => {
	const f = fixture(); f.authority.transportState = 'playing'; f.move(100);
	f.session.setMode('write', 'voice-gain'); f.move(200);
	const switched = f.session.setMode('write', 'music-gain');
	assert.equal(f.history.undoStack.length, 1);
	assert.equal(switched.active, true);
	assert.equal(switched.laneId, 'music-gain');
	f.move(300); f.stop();
	assert.equal(f.history.undoStack.length, 2);
	assert.equal(valueAt(f.lane('voice-gain'), 150), 1);
	assert.equal(valueAt(f.lane('voice-gain'), 250), .2);
	assert.equal(valueAt(f.lane('music-gain'), 199), .2);
	assert.equal(valueAt(f.lane('music-gain'), 250), 1);
});

for (const mode of ['read', 'trim', 'touch', 'latch'] as const) test(`selecting ${mode} while playing still waits for its own gesture`, () => {
	const f = fixture(); f.authority.transportState = 'playing'; f.move(100);
	assert.equal(f.session.setMode(mode, 'voice-gain').active, false);
	f.move(200); f.stop(); assert.equal(f.history.undoStack.length, 0);
});

for (const state of ['paused', 'stopped']) test(`selecting Write while ${state} only arms capture`, () => {
	const f = fixture(); f.authority.transportState = state; f.move(100);
	assert.equal(f.session.setMode('write', 'voice-gain').active, false);
	assert.equal(f.previews.length, 0);
});

test('cancelling an active Write does not silently rearm it on the next running notification', () => {
	const f = fixture(); f.authority.transportState = 'playing'; f.move(100);
	f.session.setMode('write', 'voice-gain'); f.move(200);
	assert.equal(f.session.cancelGesture(), true);
	f.move(300); f.stop();
	assert.equal(f.session.getSnapshot().active, false);
	assert.equal(f.history.undoStack.length, 0);
	assert.equal(valueAt(f.lane(), 150), .2);
});

for (const reason of ['revision', 'project', 'readOnly', 'locked', 'dispose'] as const) test(`running Write capture retains its ${reason} authority fence`, () => {
	const f = fixture(); f.authority.transportState = 'playing'; f.move(100);
	f.session.setMode('write', 'voice-gain'); f.move(200);
	if (reason === 'dispose') { f.session.dispose(); f.session.dispose(); }
	else {
		if (reason === 'revision') f.authority.projectRevision += 1;
		if (reason === 'project') f.authority.projectId = 'incoming';
		if (reason === 'readOnly') f.authority.readOnly = true;
		if (reason === 'locked') f.setLocked(true);
		f.move(300); f.stop();
	}
	assert.equal(f.session.getSnapshot().active, false);
	assert.equal(f.history.undoStack.length, 0);
});

function fixture() {
	const project = createSoundscaperProject({ id: 'running-write', tracks: ['voice', 'music'].map(id => createAudioTrack({ id })),
		automationLanes: ['voice', 'music'].map(id => ({ id: `${id}-gain`,
			address: { kind: 'strip' as const, strip: { kind: 'track' as const, id }, parameterId: 'gain' },
			timebase: 'absolute-samples' as const, points: [{ id: `${id}-a`, position: 0, value: .2 },
				{ id: `${id}-b`, position: 1000, value: .2 }], segments: [{ kind: 'hold' }] })) });
	let history = createSoundscaperProjectHistory(project), locked = false;
	const authority = { projectId: project.id, projectRevision: project.revision, readOnly: false, lockReadOnly: false,
		transportState: 'stopped', positionFrame: 0, sampleRate: project.sampleRate, tempoMap: project.tempoMap };
	const previews: SoundscaperAutomationPreview[] = [];
	const lane = (id = 'voice-gain') => history.present.automationLanes.find(lane => lane.id === id)!;
	const session = createSoundscaperAutomationSession({ captureAuthority: () => authority,
		resolveTarget: id => ({ lane: lane(id), descriptor: stripParameterDescriptor(lane(id).address), controlValue: 1, locked }),
		preview: value => { previews.push(value); },
		commit: command => {
			history = executeSoundscaperProjectCommand(history, command as AudioEditorCommand);
			authority.projectRevision = history.present.revision;
			return history.present;
		} });
	return { authority, session, previews, lane, get history() { return history; },
		move(frame: number) { authority.positionFrame = frame; session.synchronize(); },
		stop() { authority.transportState = 'stopped'; session.synchronize(); },
		setLocked(value: boolean) { locked = value; },
		undo() { history = undoSoundscaperProjectCommand(history); authority.projectRevision = history.present.revision; },
		redo() { history = redoSoundscaperProjectCommand(history); authority.projectRevision = history.present.revision; } };
}

function valueAt(lane: AutomationLaneV21, frame: number) {
	return evaluate(lane, frame, { sampleRate: 48_000 });
}
