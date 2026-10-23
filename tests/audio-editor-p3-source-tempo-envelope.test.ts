/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const factor of [.5, 2, 1]) for (const reversed of [false, true]) {
	test(`source tempo factor ${factor} retains the ${reversed ? 'reversed' : 'forward'} clip gain curve relative to its resized audio`, async context => {
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const source = createAudioSource({ id: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 48_000 });
		const envelope = [0, 12_000, 24_000, 36_000, 48_000].map((frame, index) => ({ frame, value: index === 1 || index === 2 ? 0 : 1 }));
		const clip = createAudioClip({ id: 'clip', title: 'Voice', sourceId: source.id, reversed, envelope,
			durationFrames: 48_000, sourceDurationFrames: 48_000 });
		const project = createSoundscaperProject({ id: `p3-source-envelope-${factor}-${String(reversed)}`, sources: [source], clips: [clip],
			tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [clip.id] })],
			projectBin: { clips: [createAudioClip({ ...clip, id: 'bin', binItemId: 'item' })] } });
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
		const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		await controller.actions.project.openScapeFile(new File([archive.blob], 'Voice.sscape'), () => 'copy');
		assert.equal(controller.getSnapshot().readOnly, false);
		const before: unknown = controller.project; assert.ok(validateSoundscaperProject(before));
		const processed = createAudioSource({ ...source, id: 'processed', storageKey: 'processed', frameCount: 48_000 * factor });
		const output = await store.beginSourceWrite(processed.storageKey, processed);
		for (let frame = 0; frame < processed.frameCount; frame += 65_536) {
			await output.write([new Float32Array(Math.min(65_536, processed.frameCount - frame)).fill(.25)]);
		}
		await output.commit();
		// The Source Editor effect result publishes this exact command after its PCM write.
		controller.actions.edit.commit({ type: 'source/process-audio', sourceId: before.clips[0]!.sourceId, source: processed,
			startFrame: 0, endFrame: source.frameCount });
		const after: unknown = controller.project; assert.ok(validateSoundscaperProject(after));
		for (const result of [...after.clips, ...after.projectBin.clips]) {
			assert.equal(result.durationFrames, 48_000 * factor);
			assert.deepEqual(result.envelope, envelope.map(point => ({ ...point, frame: point.frame * factor })));
			assert.equal(result.reversed, reversed);
		}
		controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before.clips);
		controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, after.clips);
	});
}
