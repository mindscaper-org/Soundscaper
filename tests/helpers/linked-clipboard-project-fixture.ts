/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioSource, createAudioClip, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './audio-editor-controller-fixtures.js';

export async function linkedClipboardFixture(context: test.TestContext, linked: boolean, frameCount = 4096, clipCount = 1) {
	const pcm = Float32Array.from({ length: frameCount }, (_, frame) => (frame % 97 - 48) / 256);
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
		id: 'origin', sources: [source], clips: Array.from({ length: clipCount }, (_, index) => createAudioClip({ id: `clip-${index}`, sourceId: source.id,
			timelineStartFrame: index * 32, durationFrames: index === 0 ? pcm.length : 32, sourceDurationFrames: index === 0 ? pcm.length : 32 })),
		tracks: [createAudioTrack({ id: 'voice', clipIds: Array.from({ length: clipCount }, (_, index) => `clip-${index}`) })],
	});
	if (linked) await store.bindLinkedAudioOriginal(project.id, source, 'original_locator_00001', { expectedSnapshot: original });
	else {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([pcm]); await writer.commit();
	}
	await store.saveProject(project);
	await controller.actions.project.openById(project.id);
	if (clipCount === 1) controller.actions.timeline.selectClip('clip-0');
	else controller.actions.timeline.selectAll();
	controller.actions.edit.copy();
	assert.equal(controller.getSnapshot().history.hasClipboard, true);
	return { controller, store, project, source, pcm, sessionController };
}
