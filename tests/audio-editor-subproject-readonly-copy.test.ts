/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { cloneSoundscaperProject, createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperEphemeralProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;

for (const followLatest of [false, true]) test(`a read-only subproject parent can save its installed audio as a copy; follow=${followLatest}`, async context => {
	const store = createSoundscaperEphemeralProjectStore(), recipient = createSoundscaperEphemeralProjectStore();
	context.after(async () => { await store.close(); await recipient.close(); });
	const source = { id: 'proxy', kind: 'audio', name: 'Child mix', sampleRate: 48000, channelCount: 1, frameCount: 4, storageKey: 'proxy' };
	const pcm = Float32Array.of(.25, -.5, .75, 0);
	const writer = await store.beginSourceWrite(source.id, { sampleRate: 48000, channelCount: 1 });
	await writer.write([pcm]); await writer.commit();
	let parent = createSoundscaperProject({ id: 'parent', sources: [source], tracks: [{ id: 'voice', type: 'audio', clipIds: ['clip'] }],
		clips: [{ id: 'clip', sourceId: source.id, durationFrames: 4, sourceDurationFrames: 4 }] });
	parent = applySoundscaperProjectCommand(parent, { type: 'subproject/install', expected: null, source, link: {
		id: 'child-link', projectId: 'child', libraryId: 'foreign-library', title: 'Child', sourceId: source.id,
		followLatest, revision: 1, contentDigest: 'a'.repeat(64), sampleRate: 48000, channelCount: 1, frameCount: 4,
	} });
	await store.saveProject(parent);
	const archives: Blob[] = [], projectRuntime = createSoundscaperProjectRuntimeSelection();
	const fileService = { ...createAudioEditorFileService(),
		prepareSave: async () => ({ mode: 'blob' as const, target: { browserDownload: true }, fileName: 'Parent.sscape' }),
		saveFile: async (request: { blob: Blob }) => { archives.push(request.blob); return { fileName: 'Parent.sscape', size: request.blob.size }; },
	};
	const archiveRuntime = createSoundscaperScapeNativeRuntime();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, projectRuntime,
		sessionController: projectRuntime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		fileService: fileService as unknown as Options['fileService'], scapeProjectRuntime: archiveRuntime,
		acquireProjectLock: async (projectId: string) => ({ projectId, readOnly: projectId === parent.id,
			method: 'test', retryAt: Date.now() + 60000, release() {} }),
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.project.openById(parent.id);
	assert.equal(controller.getSnapshot().readOnly, true);
	await controller.actions.project.saveScape({ saveCopy: true });
	assert.equal(archives.length, 1);
	const imported = await archiveRuntime.importScapeProject(archives[0]!, recipient);
	const copied = cloneSoundscaperProject(imported.project);
	const chunks: number[] = [];
	for await (const chunk of recipient.readSourceChunks(String(copied.sources[0]!.storageKey))) chunks.push(...chunk.channels[0]!);
	assert.deepEqual(chunks, [...pcm], 'the portable copy contains the installed proxy without claiming child write authority');
	assert.deepEqual(await store.loadProject(parent.id), parent, 'copying cannot update the read-only source document');
});
