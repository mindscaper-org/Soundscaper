/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { TestContext } from 'node:test';
import { createAudioEditorController } from '../../src/common/editor/app.js';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { projectForRuntimeConsumers } from '../../src/common/editor/project-current-runtime.ts';
import { createSoundscaperProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { createSoundscaperProjectRuntimeSelection } from '../../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { createSoundscaperPlaybackProjectService } from '../../src/soundscaper/editor-project-playback.ts';
import { createSoundscaperAudioTrackFreezePlaybackService } from '../../src/soundscaper/editor-audio-track-freeze-playback.ts';
import type { SoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { ENGLISH_COPY } from '../../src/common/i18n/catalogs.js';
import { createNodeWebAudioEngineFactory } from './node-web-audio-engine.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';
import { clipboardDocument, clipboardProject } from './clipboard-source-custody.ts';
import { readCustodyPcm } from './audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './assert-pcm-samples.ts';

/** Independent canonical f32le chunk digest, with the persisted source geometry. */
export function independentlyHashPcm(channels: readonly Float32Array[], chunkFrames = 65_536): string {
	const frames = channels[0]?.length; assert.ok(frames);
	assert.ok(channels.every(channel => channel.length === frames));
	const hash = createHash('sha256');
	for (let start = 0; start < frames; start += chunkFrames) {
		const end = Math.min(frames, start + chunkFrames), count = end - start;
		const bytes = Buffer.alloc(4 + count * channels.length * 4); bytes.writeUInt32LE(count, 0);
		for (const [channelIndex, channel] of channels.entries()) for (let frame = 0; frame < count; frame++)
			bytes.writeFloatLE(channel[start + frame]!, 4 + (channelIndex * count + frame) * 4);
		hash.update(bytes);
	}
	return hash.digest('hex');
}

/** Real controller, source repository, Scape archive and tracked SDK graph. */
export async function audioRenderCustody(context: TestContext) {
	const resources: {
		controller?: ReturnType<typeof createAudioEditorController>;
		native?: ReturnType<typeof createNodeWebAudioEngineFactory>;
		store?: ReturnType<typeof createSoundscaperProjectStore>;
		playback?: ReturnType<typeof createSoundscaperAudioTrackFreezePlaybackService>;
	} = {};
	let disposal: Promise<void> | undefined;
	const dispose = (): Promise<void> => disposal ??= (async () => {
		const failures: unknown[] = [];
		for (const release of [async () => resources.controller?.dispose(), async () => resources.playback?.dispose(),
			async () => resources.store?.close(), async () => resources.native?.dispose()]) {
			try { await release(); } catch (error) { failures.push(error); }
		}
		if (failures.length) throw new AggregateError(failures, 'Actual audio render custody cleanup failed.');
	})();
	context.after(dispose);
	const native = createNodeWebAudioEngineFactory(context); resources.native = native;
	const store = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false }); resources.store = store;
	const playback = createSoundscaperAudioTrackFreezePlaybackService(createSoundscaperPlaybackProjectService(), store); resources.playback = playback;
	const runtime = createSoundscaperProjectRuntimeSelection(), archive = createSoundscaperScapeNativeRuntime();
	const engine = native.createEngine();
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: ENGLISH_COPY,
		store, projectRuntime: runtime, sessionController: runtime.createSessionController(), playbackProjectService: playback,
		scapeProjectRuntime: archive, engine, engineFactory: native.createEngine }); resources.controller = controller;
	await controller.ready;
	return { controller, store, native, playback, archive, dispose,
		async open(project: SoundscaperProject, inputs: ReadonlyMap<string, readonly Float32Array[]>) {
			const donor = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
			try {
				for (const source of project.sources) {
					assert.ok(source.kind === 'audio'); const channels = inputs.get(source.id); assert.ok(channels);
					const writer = await donor.beginSourceWrite(source.storageKey, source);
					for (let start = 0; start < source.frameCount; start += source.chunkFrames)
						await writer.write(channels.map(channel => channel.subarray(start, start + source.chunkFrames)));
					await writer.commit();
				}
				const exported = await archive.exportScapeProject(project, donor); assert.ok(exported.blob);
				await controller.actions.project.openScapeFile(new File([exported.blob], 'Original.sscape', { type: 'application/zip' }), () => 'copy');
				assert.equal(controller.getSnapshot().readOnly, false);
				assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(project));
				for (const source of project.sources) {
					assert.ok(source.kind === 'audio');
					assertPcmChannelsEqual(await readCustodyPcm(store, source), inputs.get(source.id)!, 'original Scape PCM');
				}
			} finally { await donor.close(); }
		},
		async render(frames: number): Promise<Float32Array[]> {
			const project = clipboardProject(controller.project), renderer = native.createEngine();
			try {
				const buffers = new Map<string, AudioBuffer>();
				for (const source of project.sources) {
					assert.ok(source.kind === 'audio');
					const buffer = await store.loadSourceAudioBuffer(source.storageKey, await engine.getAudioContext({ resume: false }));
					assert.ok(buffer instanceof AudioBuffer); buffers.set(source.id, buffer);
				}
				renderer.loadProject(projectForRuntimeConsumers(project), buffers);
				const output = await renderer.renderMix({ startFrame: 0, endFrame: frames }); assert.ok(output instanceof AudioBuffer);
				assert.deepEqual([output.numberOfChannels, output.sampleRate, output.length], [2, 48_000, frames]);
				return Array.from({ length: 2 }, (_, channel) => {
					const pcm = new Float32Array(frames); output.copyFromChannel(pcm, channel); return pcm;
				});
			} finally { await renderer.dispose(); }
		},
	};
}
