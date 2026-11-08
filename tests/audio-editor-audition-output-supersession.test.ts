/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import { COPY, createAudioEditorController, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { MockAudioContext } from './helpers/mock-audio-context.js';
import { deferred } from './helpers/async-test-control.ts';

for (const latestFails of [false, true]) test(`public speaker choices retain the authoritative Source output, latest failure=${latestFails}`, async context => {
	const gate = deferred<void>();
	const persistingOlder = deferred<void>();
	const failure = new DOMException('Speaker B access was refused.', 'NotAllowedError');
	const contexts: SinkContext[] = [];
	let mainContext: SinkContext | null = null;
	let olderHeld = false;
	class SinkContext extends MockAudioContext {
		sinkId = '';
		async setSinkId(value: string): Promise<void> {
			if (this === mainContext && value === 'speaker-b' && latestFails) throw failure;
			if (this === mainContext && value === 'speaker-a' && !latestFails) {
				olderHeld = true;
				await gate.promise;
			}
			this.sinkId = value;
		}
	}
	const factory = (options?: AudioContextOptions): EngineAudioContext => {
		const audio = new SinkContext(options);
		contexts.push(audio);
		return audio as unknown as EngineAudioContext;
	};
	const main = createAudioEditorEngine({ audioContextFactory: factory });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const saveSetting = store.saveSetting.bind(store);
	store.saveSetting = async (key: string, value: unknown) => {
		if (latestFails && value && typeof value === 'object' && 'outputDeviceId' in value && value.outputDeviceId === 'speaker-a') {
			persistingOlder.resolve();
			await gate.promise;
		}
		return saveSetting(key, value);
	};
	const runtime = createSoundscaperProjectRuntimeSelection();
	const devices = ['speaker-a', 'speaker-b'].map((deviceId): MediaDeviceInfo => ({
		deviceId, kind: 'audiooutput', groupId: 'speakers', label: deviceId,
		toJSON: () => ({ deviceId, kind: 'audiooutput', groupId: 'speakers', label: deviceId }),
	}));
	const controller = createAudioEditorController(null, {
		headless: true, locale: 'en', copy: COPY, projectRuntime: runtime,
		sessionController: runtime.createSessionController(), store, engine: main,
		engineFactory: options => createAudioEditorEngine({ ...options, audioContextFactory: factory }),
		mediaDevices: { enumerateDevices: async () => devices },
	});
	context.after(async () => { gate.resolve(); await controller.dispose(); });
	await controller.ready;
	const writer = await store.beginSourceWrite('pcm', { sampleRate: 8_000, channelCount: 1 });
	await writer.write([new Float32Array(8_000).fill(.25)]);
	await writer.commit();
	const source = createAudioSource({ id: 'source', storageKey: 'pcm', sampleRate: 8_000, channelCount: 1, frameCount: 8_000 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, sourceDurationFrames: 8_000, durationFrames: 8_000 });
	const project = createSoundscaperProject({ id: `audition-output-${latestFails}`, sampleRate: 8_000,
		sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] }, 8_000)] });
	await store.saveProject(project, {});
	await controller.actions.project.open(project);
	await main.getAudioContext({ resume: false });
	mainContext = contexts.at(-1) ?? null;
	assert.ok(mainContext);
	await controller.actions.audioDevices.refresh({ probe: false });
	await controller.actions.clipSourcePreview.playPause(clip.id);
	const previewContext = contexts.at(-1);
	assert.ok(previewContext);
	assert.notEqual(previewContext, mainContext);
	const currentContexts = [mainContext, previewContext];
	const older = controller.actions.audioDevices.setOutput('speaker-a');
	if (latestFails) {
		await persistingOlder.promise;
		await assert.rejects(controller.actions.audioDevices.setOutput('speaker-b'), error => error === failure);
	} else {
		assert.equal(olderHeld, true);
		await controller.actions.audioDevices.setOutput('speaker-b');
		assert.deepEqual(currentContexts.map(audio => audio.sinkId), ['speaker-b', 'speaker-b']);
	}
	gate.resolve();
	assert.equal(await older, 'speaker-a', 'the routing service retains its requested-choice return semantics');
	const authoritative = latestFails ? 'speaker-a' : 'speaker-b';
	const devicesState = controller.getSnapshot().audioDevices;
	assert.ok(devicesState && typeof devicesState === 'object');
	assert.equal(Reflect.get(devicesState, 'preferredOutputDeviceId'), authoritative);
	assert.equal(main.getOutputDeviceState().preferredDeviceId, authoritative);
	assert.deepEqual(currentContexts.map(audio => audio.sinkId), [authoritative, authoritative],
		'an earlier completion must broadcast the current output, including a newer failure’s valid fallback');
});
