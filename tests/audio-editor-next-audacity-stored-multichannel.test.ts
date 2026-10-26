/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createFixture } from './helpers/native-project-service-fixture.ts';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const format of ['aup3', 'aup4'] as const) test(`NP057: File Export ${format} reads nonresident multichannel audio`, async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const archiveStore = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}:archive` });
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 1_440_000, channelCount: 6 });
	const original = createSoundscaperProject({ id: `stored-${format}`, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
	const writer = await archiveStore.beginSourceWrite(source.storageKey, source);
	for (let offset = 0; offset < source.frameCount; offset += 65_536) {
		await writer.write(Array.from({ length: 6 }, (_, channel) => new Float32Array(Math.min(65_536, source.frameCount - offset)).fill((channel + 1) / 16)));
	}
	await writer.commit();
	const archive = await exportScapeProject(original, archiveStore); assert.ok(archive.blob instanceof Blob);
	await archiveStore.close();
	let readSources = 0;
	const client = { ...createFixture().runtime.createAup4Client({}),
		writeSnapshot: async (_id: string, _project: unknown, sources: AsyncIterable<{ channels: readonly Float32Array[] }>) => {
			for await (const value of sources) {
				readSources += 1; assert.equal(value.channels.length, 6);
				for (const [channel, pcm] of value.channels.entries()) {
					assert.equal(pcm.length, source.frameCount); assert.equal(pcm[0], (channel + 1) / 16);
					assert.equal(pcm.at(-1), (channel + 1) / 16);
				}
			}
			return {};
		},
	};
	const savedFiles: string[] = [];
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store, aup4Client: client,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		fileService: { isDesktop: false, saveFile: async (request: { suggestedName: string; blob: Blob }) => {
			savedFiles.push(request.suggestedName); return { fileName: request.suggestedName, size: request.blob.size };
		} } as unknown as Options['fileService'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Surround.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	const saved = await (format === 'aup3' ? controller.actions.project.saveAup3({ useFileSystemAccess: false }) : controller.actions.project.saveAup4({ useFileSystemAccess: false }));
	assert.ok(saved && !('cancelled' in saved)); assert.equal(readSources, 1);
	assert.equal(savedFiles.length, 1); assert.match(savedFiles[0] ?? '', new RegExp(`\\.${format}$`, 'u'));
});
