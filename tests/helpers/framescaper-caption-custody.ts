/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';

import { openFramescaperCaptionSidecarFile, saveFramescaperCaptionSidecarFile } from '../../src/common/editor/ui/framescaper-caption-file-interchange.ts';
import { exportFramescaperCaptionSidecar, importFramescaperCaptionSidecar } from '../../src/common/editor/ui/framescaper-finishing-dialog-model.ts';
import type { VideoCaptionInterchangeFormatV1 } from '../../src/common/editor/video-caption-interchange-contract-v27.ts';
import { normalizeVideoCaptionTrackV1 } from '../../src/common/editor/video-caption-track-v27.ts';
import { cloneFramescaperProject, type FramescaperProject } from '../../src/framescaper/editor-project.ts';
import { createEditorProjectRuntimeSelection } from '../../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { createMemoryFfmpeg } from './audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './audio-editor-controller-harness.js';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';

/** Only audio devices and the final save picker are substituted; no caption output is faked. */
export async function framescaperCaptionCustody(context: TestContext, file: File) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createEditorProjectRuntimeSelection(PROFILE);
	const archive = createFramescaperScapeNativeRuntime(PROFILE);
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	const controller = createAudioEditorController(null, { headless: true, productId: 'framescaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store, scapeProjectRuntime: archive,
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		engineFactory: () => { throw new Error('Caption custody must not invoke a substitute renderer.'); } });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const initial = cloneFramescaperProject(PROFILE, controller.project);
	const opened = await openFramescaperCaptionSidecarFile({ file });
	assert.ok(opened);
	const imported = importFramescaperCaptionSidecar({ project: initial, format: opened.format, text: opened.text,
		trackId: 'captions', sequenceId: initial.primarySequenceId, trackName: 'Dialogue', language: 'en' });
	assert.ok(imported.command);
	controller.actions.edit.commit(imported.command);
	const committed = cloneFramescaperProject(PROFILE, controller.project);
	const expected = captionTrack(committed);
	controller.actions.edit.undo();
	assert.deepEqual(cloneFramescaperProject(PROFILE, controller.project).videoCaptionTracks, initial.videoCaptionTracks);
	controller.actions.edit.redo();
	assert.deepEqual(captionTrack(cloneFramescaperProject(PROFILE, controller.project)), expected);
	await controller.actions.project.flush();
	const persisted = cloneFramescaperProject(PROFILE, await store.loadProject(committed.id));
	assert.deepEqual(captionTrack(persisted), expected, 'caption publication reaches the real project store');

	const exported = await archive.exportScapeProject(persisted, store);
	assert.ok(exported.blob);
	const recipient = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	context.after(async () => { await recipient.close(); });
	const delivered = await archive.importScapeProject(exported.blob, recipient);
	assert.equal(delivered.readOnly, false);
	const project = cloneFramescaperProject(PROFILE, delivered.project);
	const track = captionTrack(project);
	assert.deepEqual(track, expected, 'every caption field survives the native Framescaper Scape codec');
	assert.deepEqual(captionTrack(cloneFramescaperProject(PROFILE, await recipient.loadProject(project.id))), expected);

	return {
		project, track, losses: imported.result.losses,
		async sidecar(format: VideoCaptionInterchangeFormatV1) {
			const result = exportFramescaperCaptionSidecar({ project, trackId: track.id, format });
			const files: File[] = [];
			await saveFramescaperCaptionSidecarFile({ format, trackId: track.id, text: result.text,
				fileService: { saveFile(request) {
					files.push(new File([request.text], request.suggestedName, { type: request.mimeType }));
				} } });
			assert.equal(files.length, 1);
			const file = files[0]; assert.ok(file);
			const opened = await openFramescaperCaptionSidecarFile({ file }); assert.ok(opened);
			const restored = importFramescaperCaptionSidecar({ project, format: opened.format, text: opened.text,
				trackId: track.id, sequenceId: track.sequenceId, trackName: track.name, language: track.language });
			return { ...result, file, restored: restored.result.track };
		},
	};
}

function captionTrack(project: FramescaperProject) {
	assert.ok(Array.isArray(project.videoCaptionTracks));
	assert.equal(project.videoCaptionTracks.length, 1);
	return normalizeVideoCaptionTrackV1(project.videoCaptionTracks[0]);
}
