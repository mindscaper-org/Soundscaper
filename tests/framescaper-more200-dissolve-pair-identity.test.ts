/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { bindFramescaperSelectedAuthoringController, framescaperSelectedVisualAuthoringRuntimeFor } from '../src/framescaper/editor-selected-finishing-authoring-controller.ts';
import { createFramescaperSelectedVisualAuthoringModel } from '../src/framescaper/editor-selected-finishing-visual-authoring-model.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';

for (const long of [false, true]) test(`dissolve targets the selected pair with ${long ? 'long' : 'colon-containing'} native IDs`, async () => {
	const rows: readonly (readonly [string, string, string])[] = long ? [['first', 'a', 'b'], ['x'.repeat(128), 'y'.repeat(128), 'z'.repeat(128)]]
		: [['t', 'a:b', 'c:d'], ['t:a', 'b:c', 'd']];
	const selected = rows[1]![1]!;
	const project = createFramescaperProject(PROFILE, { id: 'pair-identity', primarySequenceId: 'main',
		sources: [createVideoSource({ id: 'camera', name: 'Camera', storageKey: 'camera', mimeType: 'video/webm',
			contentSha256: 'ab'.repeat(32), frameRate: { num: 30, den: 1 }, sourceFrameCount: 120,
			sampleFrameCount: 192_000, width: 160, height: 90 })],
		clips: rows.flatMap(([, outgoing, incoming]) => [outgoing!, incoming!].map((id, index) => ({
			kind: 'video', id, title: id, sourceId: 'camera', sequenceId: 'main', sequenceStartFrame: index * 30,
			sequenceFrameCount: 30, sourceInFrame: index * 30, sourceFrameCount: 30, retimeMap: null }))),
		tracks: rows.map(([id, outgoing, incoming]) => ({ id, type: 'video', clipIds: [outgoing, incoming] })),
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: rows.map(([id]) => id) }] });
	const runtime = createEditorProjectRuntimeSelection(PROFILE); let history = runtime.createHistory(project);
	const controller = { get project() { return history.present; }, getSnapshot: () => ({ selectedClipId: selected }),
		getTelemetrySnapshot: () => ({ positionFrame: 0 }), actions: { edit: { commit(command: unknown) {
			history = runtime.executeCommand(history, command);
		} } } };
	bindFramescaperSelectedAuthoringController({ controller,
		store: createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false }) });
	const model = createFramescaperSelectedVisualAuthoringModel({ project, surface: 'video-transition-dissolve',
		selectedClipId: selected, playheadSample: 0 });
	const author = framescaperSelectedVisualAuthoringRuntimeFor(controller); assert.ok(author && model.selectedPairId);
	await author.run('video-transition-dissolve', { fence: model.fence, clipId: selected, operation: 'apply',
		pairId: model.selectedPairId, durationFrames: 9 });
	assert.deepEqual(history.present.tracks[0], project.tracks[0], 'the unrelated first pair must remain unchanged');
	assert.deepEqual(history.present.clips.filter(clip => rows[0]!.slice(1).includes(clip.id)), project.clips.slice(0, 2));
	const incoming = history.present.clips.find(clip => clip.id === rows[1]![2]); assert.ok(incoming?.kind === 'video');
	assert.equal(incoming.sequenceStartFrame, 21);
	assert.equal(new Set(model.transitionPairs.map(pair => pair.id)).size, 2);
	const undone = runtime.undo(history);
	assert.deepEqual(undone.present.clips, project.clips); assert.deepEqual(undone.present.tracks, project.tracks);
	assert.deepEqual(undone.present.sources, project.sources);
	const redone = runtime.redo(undone);
	assert.deepEqual(redone.present.clips, history.present.clips); assert.deepEqual(redone.present.tracks, history.present.tracks);
});
