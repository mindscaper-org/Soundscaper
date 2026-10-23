/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioSource, createAudioClip, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

async function fixture(context: test.TestContext, linked: boolean) {
	const pcm = new Float32Array(4096).fill(.25);
	const encoded = encodeWav([pcm], { sampleRate: 48_000, float: true, dither: 'none' });
	assert.ok(encoded instanceof Uint8Array);
	const original = new Blob([Uint8Array.from(encoded)], { type: 'audio/wav' });
	const port = { load() { return { blob: original, locatorRevision: 'original_revision_00001' }; }, release() { return true; } };
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name, linkedOriginalPort: port });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const sessionController = runtime.createSessionController();
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, {
		headless: true, locale: 'en', copy: COPY, store, projectRuntime: runtime,
		sessionController, engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const source = createAudioSource({ id: 'linked', sampleRate: 48_000, frameCount: pcm.length, channelCount: 1 });
	const project = createSoundscaperProject({
		id: 'origin', sources: [source], clips: [createAudioClip({ id: 'clip', sourceId: source.id,
			durationFrames: pcm.length, sourceDurationFrames: pcm.length })], tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })],
	});
	if (linked) await store.bindLinkedAudioOriginal(project.id, source, 'original_locator_00001', { expectedSnapshot: original });
	else {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([pcm]); await writer.commit();
	}
	await store.saveProject(project);
	await controller.actions.project.openById(project.id);
	controller.actions.timeline.selectClip('clip'); controller.actions.edit.copy();
	assert.equal(controller.getSnapshot().history.hasClipboard, true);
	return { controller, store, project, source, pcm, sessionController };
}

for (const linked of [false, true]) test(`Copy, Delete project, Paste preserves ${linked ? 'linked' : 'managed'} audio`, async (context) => {
	const { controller, store, project, pcm } = await fixture(context, linked);
	await controller.actions.project.remove();
	assert.notEqual(controller.project?.id, project.id);
	assert.equal(controller.getSnapshot().history.hasClipboard, true);
	await controller.actions.edit.paste();
	const pasted = controller.project;
	assert.ok(pasted); assert.equal(pasted.clips.length, 1);
	const archive = await exportScapeProject(pasted, store);
	assert.ok(archive.blob instanceof Blob);
	const source = pasted.sources[0]; assert.ok(source);
	const session = await store.openSourceReadSession(source.storageKey);
	assert.ok(session);
	try { assert.deepEqual((await session.chunk(0)).channels, [pcm]); }
	finally { await session.release(); }
	assert.equal(await store.loadProject(project.id), null);
});

test('failed linked clipboard preservation leaves the original project and binding editable', async (context) => {
	const { controller, store, project, source } = await fixture(context, true);
	const originalBinding: unknown = await store.getLinkedOriginalBinding(project.id, source.id);
	const begin = store.beginSourceWrite.bind(store);
	store.beginSourceWrite = () => Promise.reject(new Error('Clipboard PCM storage failed'));
	await assert.rejects(controller.actions.project.remove(), /Clipboard PCM storage failed/u);
	assert.equal(controller.project?.id, project.id);
	assert.ok(await store.loadProject(project.id));
	assert.deepEqual(await store.getLinkedOriginalBinding(project.id, source.id), originalBinding);
	store.beginSourceWrite = begin;
	await controller.actions.project.rename('Still editable');
	assert.equal(controller.project?.title, 'Still editable');
	await controller.actions.project.remove();
	assert.notEqual(controller.project?.id, project.id);
});

test('a changed clipboard retires the staged copy before project deletion', async (context) => {
	const { controller, store, project, source, sessionController } = await fixture(context, true);
	const begin = store.beginSourceWrite.bind(store);
	let aborted = 0;
	store.beginSourceWrite = async (...args: Parameters<typeof begin>) => {
		const writer = await begin(...args);
		return { ...writer,
			async write(channels: unknown) { await writer.write(channels); sessionController.clearClipboard(); },
			async abort() { aborted += 1; await writer.abort(); },
		};
	};
	await assert.rejects(controller.actions.project.remove(), { name: 'AbortError' });
	assert.equal(aborted, 1);
	assert.equal(controller.project?.id, project.id);
	assert.ok(await store.getLinkedOriginalBinding(project.id, source.id));
	const metadata: unknown = await store.getSourceMetadata(source.storageKey);
	assert.ok(metadata && typeof metadata === 'object' && 'storage' in metadata);
	assert.equal(metadata.storage, 'linked-audio-original-v1');
	await controller.actions.project.rename('Still editable after cancellation');
	assert.equal(controller.project?.title, 'Still editable after cancellation');
});

test('deleting a project without copied media does not read its linked original', async (context) => {
	const { controller, store, project, sessionController } = await fixture(context, true);
	sessionController.clearClipboard();
	store.openSourceReadSession = () => { throw new Error('Unexpected clipboard materialization'); };
	await controller.actions.project.remove();
	assert.notEqual(controller.project?.id, project.id);
});
