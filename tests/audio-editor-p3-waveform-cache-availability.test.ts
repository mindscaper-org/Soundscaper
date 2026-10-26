/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const route of ['open', 'import'] as const) for (const failure of route === 'open' ? ['read', 'write', 'none'] as const : ['write', 'none'] as const) test(`File ${route} keeps durable PCM available when waveform cache ${failure} fails`, async context => {
	const source = createAudioSource({ id: 'source', name: 'Healthy recording', sampleRate: 48_000, frameCount: 4_800, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, timelineStartFrame: 0, durationFrames: 4_800, sourceStartFrame: 0, sourceDurationFrames: 4_800 });
	const project = createSoundscaperProject({ id: context.name, title: 'Healthy recording', sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })] });
	const rawStore = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const writer = await rawStore.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(4_800).fill(.25)]); await writer.commit();
	const archive = await exportScapeProject(project, rawStore); assert.ok(archive.blob instanceof Blob);
	let cacheCalls = 0;
	const store = new Proxy(rawStore, { get(target, property, receiver) {
		if ((failure === 'read' && property === 'loadAnalysis') || (failure === 'write' && property === 'saveAnalysis')) {
			return async (key: string) => {
				if (key.includes('peaks')) { cacheCalls++; throw new DOMException('Waveform cache is full', 'QuotaExceededError'); }
				return property === 'loadAnalysis' ? await target.loadAnalysis(key) : undefined;
			};
		}
		const value: unknown = Reflect.get(target, property, receiver);
		return typeof value === 'function' ? value.bind(target) as unknown : value;
	} });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	if (route === 'open') await controller.actions.project.openScapeFile(new File([archive.blob], 'Healthy.sscape'), () => 'copy');
	else {
		const bytes = Uint8Array.from(encodeWav([new Float32Array(4_800).fill(.25)], { sampleRate: 48_000, bitDepth: 32, float: true }));
		await controller.actions.project.importFiles([new File([bytes], 'Healthy.wav', { type: 'audio/wav' })]);
	}
	assert.equal(controller.getSnapshot().readOnly, false);
	const loaded = controller.project; assert.ok(loaded); assert.equal(loaded.clips.length, 1);
	const loadedSource = loaded.sources[0]; assert.ok(loadedSource);
	const channels: Float32Array[] = [];
	for await (const chunk of rawStore.readSourceChunks(String(loadedSource.storageKey))) channels.push(chunk.channels[0]!);
	assert.equal(channels[0]?.[0], .25, 'the original recording is still physically readable');
	if (failure !== 'none') assert.ok(cacheCalls > 0, 'the failure injection exercised the optional waveform cache');
	assert.deepEqual(controller.getSnapshot().missingSourceIds, [], 'optional waveform cache failure must not report missing recording bytes');
	const saved = await controller.actions.project.saveScape({ saveCopy: true, useFileSystemAccess: false });
	assert.ok(saved && !('cancelled' in saved), 'a healthy project can still be saved');
});
