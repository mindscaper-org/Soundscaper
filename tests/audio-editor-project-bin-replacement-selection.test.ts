/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createVideoClip, createVideoSource } from '../src/common/editor/project-media-factory.ts';
import type { ProjectBinProject } from '../src/common/editor/controller/import/project-bin-types.ts';
import { replacementSelectionChange } from '../src/common/editor/controller/import/internal/project-bin/project-bin-replacement-selection.ts';
import { clipFixture, createHarness, projectFixture } from './helpers/project-bin-service-harness.ts';
import { framescaperModelOptions } from './helpers/framescaper-model-fixture-common.ts';

const scenarios = [
	{ fail: false, historyEdit: false, mode: 'changed' }, { fail: true, historyEdit: false, mode: 'changed' },
	{ fail: false, historyEdit: true, mode: 'changed' }, { fail: true, historyEdit: true, mode: 'changed' },
	{ fail: false, historyEdit: false, mode: 'returned' }, { fail: false, historyEdit: false, mode: 'noop' },
] as const;
for (const { fail, historyEdit, mode } of scenarios) test(`selection during replacement activation preserves ownership, activation failure=${fail}, newer history=${historyEdit}, selection=${mode}`, async () => {
	const base = createFramescaperProject(PROFILE, framescaperModelOptions({ id: 'replacement-selection', title: 'Original', now: '2026-10-10T00:00:00Z' }));
	const source = createVideoSource({ id: 'temporary-source', storageKey: 'temporary-source', name: 'Replacement',
		contentSha256: '34'.repeat(32), sampleFrameCount: 12_960, sourceFrameCount: 4, frameRate: { num: 400, den: 27 }, width: 96, height: 54 });
	const clip = createVideoClip({ id: 'temporary-bin', binItemId: 'temporary-item', sourceId: source.id, title: 'Temporary',
		sequenceStartFrame: 0, sequenceFrameCount: 3, sourceInFrame: 0, sourceFrameCount: 4 },
	{ projectSampleRate: base.sampleRate, sequence: base.sequences[0]!, source });
	const imported = applyFramescaperProjectCommand(PROFILE, base, { type: 'batch', commands: [
		{ type: 'source/add', source }, { type: 'project-bin/add', clip },
	] });
	const started = deferred(), activation = deferred();
	const harness = createHarness(asBin(base), {
		applySelection: (project, command) => asBin(applyFramescaperProjectCommand(PROFILE, project, command)),
		importProjectBinFile: async () => {
			harness.replaceImportedDocument(asBin(imported), { present: imported, undoStack: ['temporary-import'] });
			return { clipId: clip.id };
		},
		awaitVideoSourceActivation: async () => {
			started.resolve(); await activation.promise;
			if (fail) throw new Error('Activation failed.');
		},
	});
	const history = harness.history;
	const preparing = harness.service.prepareProjectBinReplacement('bin-video', { name: 'replacement.mp4' });
	const rejected = assert.rejects(preparing);
	await started.promise;
	const selection = { type: 'selection/set' as const, startFrame: 100, endFrame: 200, trackIds: ['video-track'], clipIds: ['video-clip'] };
	const changed = applyFramescaperProjectCommand(PROFILE, harness.project, selection);
	const selected = mode === 'changed' ? changed : applyFramescaperProjectCommand(PROFILE,
		mode === 'returned' ? changed : harness.project, { type: 'selection/set', ...imported.selection });
	const latestHistory = { present: selected, undoStack: historyEdit ? ['temporary-import', 'newer-edit'] : ['temporary-import'] };
	harness.replaceImportedDocument(asBin(selected), latestHistory);
	activation.resolve(); await rejected;
	if (historyEdit) {
		assert.equal(harness.project, selected);
		assert.equal(harness.history, latestHistory);
		assert.deepEqual(harness.deletedMedia, []);
		return;
	}
	assert.equal(harness.project.sources.some(candidate => candidate.id === source.id), false);
	assert.equal(harness.project.projectBin?.clips.some(candidate => candidate.id === clip.id), false);
	assert.deepEqual(harness.project.selection, selected.selection);
	assert.deepEqual(harness.history, { ...(history as object), present: harness.project });
	assert.deepEqual(harness.deletedMedia, [source.id]);
	assert.equal(harness.selectedClipId, selected.selection.clipIds[0] ?? null);
	const selectedTrackIds = selected.selection.trackIds;
	assert.ok(selectedTrackIds !== undefined, 'Canonical selection commands must retain their explicit track ID list.');
	assert.equal(harness.selectedTrackId, selectedTrackIds[0] ?? null);
	assert.equal(harness.commits.length, 0);
});

test('selection rollback filters temporary clip, track and annotation identities while retaining the range', () => {
	const base = { ...projectFixture({ clips: [clipFixture({ id: 'kept' })] }), timelineAnnotations: [{ id: 'kept-annotation' }] };
	const imported = { ...base, selection: { startFrame: 0, endFrame: 0, clipIds: [] } };
	const latest = { ...structuredClone(imported), revision: imported.revision + 1,
		selection: { startFrame: 5, endFrame: 8, clipIds: ['kept', 'temporary'], trackIds: ['track', 'temporary-track'],
			annotationIds: ['kept-annotation', 'temporary-annotation'], frequencyRange: { minimumFrequency: 10, maximumFrequency: 100 } } };
	const history = { present: imported, undoStack: [] };
	const command = replacementSelectionChange(base, { project: imported, history }, { project: latest, history: { ...history, present: latest } });
	assert.deepEqual(command, { type: 'selection/set', startFrame: 5, endFrame: 8,
		clipIds: ['kept'], trackIds: ['track'], annotationIds: ['kept-annotation'], frequencyRange: { minimumFrequency: 10, maximumFrequency: 100 } });
	assert.equal(replacementSelectionChange(base, { project: imported, history },
		{ project: { ...latest, title: 'Newer content' }, history: { ...history, present: latest } }), null);
});

function asBin(project: unknown): ProjectBinProject { return project as ProjectBinProject; }
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(complete => { resolve = complete; });
	return { promise, resolve };
}
