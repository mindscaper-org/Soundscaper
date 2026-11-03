/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { snapshotInertEditorCommand } from '../src/common/editor/commands/editor-command-snapshot.ts';
import { createProjectMutationService } from '../src/common/editor/controller/document/project-mutation-service.ts';

const namingCommands = [
	{ type: 'track/update', trackId: 'track', changes: { name: 'Dialogue' } },
	{ type: 'clip/update', clipId: 'clip', changes: { title: 'Opening' } },
] as const satisfies readonly AudioEditorCommand[];

for (const command of namingCommands) test(`${command.type} naming preserves playback and still publishes undoable, saved state`, async () => {
	const fixture = mutationFixture();
	const previous = fixture.project();
	fixture.service.commit(command);
	await nextTurn();
	assert.equal(fixture.project().revision, previous.revision + 1);
	assert.deepEqual(fixture.state.history.undoStack, [{ project: previous }]);
	assert.equal(fixture.published(), 1);
	assert.equal(fixture.saved(), 1);
	assert.equal(fixture.prepared(), 0, 'renaming must not prepare time/pitch playback');
	assert.deepEqual(fixture.applied, [], 'renaming must not tear down the active audio graph');

	fixture.service.commit(command);
	await nextTurn();
	assert.deepEqual(fixture.applied, [], 'successive renames remain independent of playback');
});

for (const command of [
	{ type: 'track/update', trackId: 'track', changes: { name: 'Dialogue', gain: .5 } },
	{ type: 'clip/update', clipId: 'clip', changes: { title: 'Opening', speedRatio: 1.5 } },
	{ type: 'track/update', trackId: 'track', changes: { mute: true } },
	{ type: 'clip/update', clipId: 'clip', changes: { gain: .5 } },
] as const satisfies readonly AudioEditorCommand[]) test(`${JSON.stringify(command.changes)} still refreshes playback`, async () => {
	const fixture = mutationFixture();
	fixture.service.commit(command);
	await nextTurn();
	assert.equal(fixture.prepared(), 1);
	assert.deepEqual(fixture.applied, [fixture.project()]);
});

for (const phase of ['preparing', 'applying'] as const) test(`a rename during pending playback ${phase} still applies the latest audio edit`, async () => {
	let release!: () => void;
	const pending = new Promise<void>(resolve => { release = resolve; });
	let entered!: () => void;
	const started = new Promise<void>(resolve => { entered = resolve; });
	let first = true;
	const fixture = mutationFixture({
		async before(when) {
			if (when !== phase || !first) return;
			first = false;
			entered();
			await pending;
		},
	});
	fixture.service.commit({ type: 'clip/update', clipId: 'clip', changes: { gain: .5 } });
	await started;
	try {
		fixture.service.commit(namingCommands[0]);
		await nextTurn();
	} finally {
		release();
	}
	await nextTurn();
	assert.equal(fixture.applied.at(-1), fixture.project(), 'the name change cannot strand the preceding audio edit');
	assert.deepEqual(fixture.errors, []);
	const applied = fixture.applied.length;
	fixture.service.commit(namingCommands[1]);
	await nextTurn();
	assert.equal(fixture.applied.length, applied, 'after pending audio settles, renames leave playback intact again');
});

test('an explicit playback refresh overrides the name-only optimization', async () => {
	const fixture = mutationFixture();
	fixture.service.commit(namingCommands[0], {}, { skipPlaybackEngine: false });
	await nextTurn();
	assert.deepEqual(fixture.applied, [fixture.project()]);
});

test('a failed playback refresh releases its pending state', async () => {
	const error = new Error('Playback preparation failed');
	const fixture = mutationFixture({ before: async () => { throw error; } });
	fixture.service.commit({ type: 'clip/update', clipId: 'clip', changes: { gain: .5 } });
	await nextTurn();
	assert.deepEqual(fixture.errors, [error]);
	fixture.service.commit(namingCommands[0]);
	await nextTurn();
	assert.equal(fixture.prepared(), 1, 'a failed audio edit must not make every later rename restart preparation');
	assert.deepEqual(fixture.errors, [error]);
});

function mutationFixture(options: { before?: (phase: 'preparing' | 'applying') => Promise<void> } = {}) {
	const initial = { id: 'project', revision: 0, tracks: [{ id: 'track' }], clips: [{ id: 'clip' }] };
	type Project = typeof initial;
	let project = initial;
	const state = {
		readOnly: false,
		projectActivationPending: false,
		history: { present: project, undoStack: [] as { project: Project }[] },
		selectedTrackId: null,
		selectedClipId: null,
		projectBinPreview: null,
	};
	let prepared = 0;
	let published = 0;
	let saved = 0;
	const applied: Project[] = [];
	const errors: unknown[] = [];
	const service = createProjectMutationService({
		lifetime: { capture: () => 1, assertActive() {} }, state,
		productName: 'Soundscaper', projectReadOnlyMessage: 'Read only',
		capabilities: { audioEffects: true, audioRecording: true, audioSpectralEditing: true,
			audioWarp: true, takeComp: true, timelineAnnotations: true, trackFolders: true, videoEffects: true },
		assertEditingAllowed() {},
		getProject: () => project,
		setProject(value) { assert.ok(value); project = value; },
		getHistory: () => state.history,
		setHistory(value) { state.history = value; },
		executeEditorCommand(history, command) {
			snapshotInertEditorCommand(command);
			return { present: { ...history.present, revision: history.present.revision + 1 },
				undoStack: [...history.undoStack, { project: history.present }] };
		},
		applyEditorCommand: value => value,
		retention: { compactLiveSourceState() {}, retainLiveClipIds() {}, synchronizeLiveHistory: value => value },
		publisher: { publishProjectState() { published += 1; } },
		saves: { scheduleAutosave() { saved += 1; return true; }, flushProject() {} },
		stopProjectBinPreview() {}, clearWaveformPcmWindows() {},
		reconcileRecordingRouting: () => false, persistRecordingRouting: async () => undefined,
		findClip: (value, id) => value.clips.find(clip => clip.id === id) ?? null,
		findTrack: (value, id) => value.tracks.find(track => track.id === id) ?? null,
		synchronizeMicrophoneMeterTarget() {}, synchronizeAnnotationFocus() {},
		getPlaybackState: () => 'playing', projectHasTimePitchClips: () => true,
		async beginPlaybackCachePreparation() { prepared += 1; await options.before?.('preparing'); },
		async applyProjectToPlaybackEngine(value) { applied.push(value); await options.before?.('applying'); },
		captureProject: (projectId: string) => projectId, assertProject() {},
		handleError(error) { errors.push(error); }, isExpectedCancellation: () => false,
	});
	return { service, state, applied, errors, project: () => project,
		prepared: () => prepared, published: () => published, saved: () => saved };
}
