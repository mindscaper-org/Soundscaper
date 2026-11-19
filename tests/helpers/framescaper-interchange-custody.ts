/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { TestContext } from 'node:test';

import { exportProjectEdl, exportProjectOtio } from '../../src/common/editor/controller/export/interchange-export-action.ts';
import { createVideoSource } from '../../src/common/editor/project-media-factory.ts';
import { createFramescaperProject, cloneFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { createEditorProjectRuntimeSelection } from '../../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { videoPreviewBenchmarkMedia } from '../browser/fixtures/video-preview-benchmark-media.js';
import { createMemoryFfmpeg } from './audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './audio-editor-controller-harness.js';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';

export async function framescaperInterchangeCustody(context: TestContext, options: Readonly<{
	sourceId?: string; fps?: number; sourceInFrame?: number;
}> = {}) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const bytes = Uint8Array.from(videoPreviewBenchmarkMedia.file.buffer);
	assert.equal(createHash('sha256').update(bytes).digest('hex'), videoPreviewBenchmarkMedia.sourceSha256);
	const source = createVideoSource({ id: options.sourceId ?? 'camera', storageKey: crypto.randomUUID(), name: 'CAMERA',
		mimeType: 'video/webm', contentSha256: videoPreviewBenchmarkMedia.sourceSha256, frameRate: { num: 30, den: 1 },
		sourceFrameCount: 180, sampleFrameCount: 288_000, width: 1_280, height: 720 });
	const project = createFramescaperProject(PROFILE, { id: crypto.randomUUID(), title: 'Interchange custody', sources: [source],
		clips: [{ kind: 'video', id: 'picture', title: 'Picture', sourceId: source.id, sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: options.fps ?? 30, sourceInFrame: options.sourceInFrame ?? 0, sourceFrameCount: 30, retimeMap: null }],
		tracks: [{ id: 'pictures', type: 'video', clipIds: ['picture'] }],
		sequences: [{ id: 'main', rate: { num: options.fps ?? 30, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main' });
	const archive = createFramescaperScapeNativeRuntime(PROFILE);
	const makeStore = () => createFramescaperProjectStore(PROFILE, {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
	});
	const sender = makeStore();
	context.after(async () => { await sender.close(); });
	await sender.writeMediaAsset(source.storageKey, new Blob([bytes], { type: 'video/webm' }), { name: 'Camera.webm', mimeType: 'video/webm' });
	const original = await archive.exportScapeProject(project, sender); assert.ok(original.blob);
	const store = makeStore();
	const runtime = createEditorProjectRuntimeSelection(PROFILE);
	const controller = createAudioEditorController(null, { headless: true, productId: 'framescaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store, scapeProjectRuntime: archive,
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		engineFactory: () => { throw new Error('Interchange envelope custody must not invoke a substitute renderer.'); } });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.project.openScapeFile(new File([original.blob], 'Interchange.fscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	const initial = cloneFramescaperProject(PROFILE, controller.project);
	assert.deepEqual(initial.clips, project.clips);

	return {
		controller, initial,
		async deliver(format: 'edl' | 'otio') {
			await controller.actions.project.flush();
			const current = cloneFramescaperProject(PROFILE, controller.project);
			const exported = await archive.exportScapeProject(current, store); assert.ok(exported.blob);
			const recipient = makeStore();
			try {
				const result = await archive.importScapeProject(exported.blob, recipient);
				assert.equal(result.readOnly, false);
				const reopened = cloneFramescaperProject(PROFILE, result.project);
				assert.deepEqual(reopened.sources, current.sources);
				assert.deepEqual(reopened.clips, current.clips);
				assert.deepEqual(reopened.sequences, current.sequences);
				const retained = reopened.sources[0]; assert.ok(retained?.kind === 'video');
				const body = await recipient.loadMediaAsset(retained.storageKey);
				assert.ok(body instanceof Blob);
				assert.deepEqual(new Uint8Array(await body.arrayBuffer()), bytes, 'real source bytes survive both native archive legs');
				const files: Blob[] = [];
				const input = { getProject: () => reopened, state: {}, projectForRuntimeConsumers: runtime.projectForRuntimeConsumers,
					fileService: { saveFile(request: Readonly<Record<string, unknown>>) {
						assert.equal(request.purpose, 'interchange'); assert.ok(request.blob instanceof Blob);
						files.push(request.blob);
					} } };
				const delivery = format === 'edl' ? await exportProjectEdl(input) : await exportProjectOtio(input);
				assert.ok(delivery); assert.equal(files.length, 1);
				assert.equal(await files[0]!.text(), delivery.text);
				return { project: reopened, text: delivery.text };
			} finally { await recipient.close(); }
		},
	};
}
