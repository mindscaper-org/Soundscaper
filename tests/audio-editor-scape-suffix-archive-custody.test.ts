/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { openWorkspaceProjectFile } from '../src/common/editor/ui/workspace/open-workspace-project-file.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { readPcm } from './helpers/project-store-pcm-fixture.ts';

for (const product of ['soundscaper', 'framescaper'] as const) for (const name of ['reserved.liscape', 'legacy.SCAPE']) {
	for (const mimeType of ['application/vnd.soundscaper.scape+zip', 'application/zip']) test(`${product} opens ${name}/${mimeType} and retains its actual audio archive`, async context => {
		const runtime = createSoundscaperScapeNativeRuntime();
		const sender = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
		context.after(async () => { await sender.close(); });
		const source = createAudioSource({ id: 'voice', name: 'Voice.wav', sampleRate: 48_000, frameCount: 4800, channelCount: 1 });
		const clip = createAudioClip({ id: 'voice-clip', title: 'Stored voice', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800 });
		const project = createSoundscaperProject({ id: 'suffix-custody', title: 'Suffix custody', sources: [source], clips: [clip],
			tracks: [createAudioTrack({ id: 'voice-track', name: 'Voice', clipIds: [clip.id] })] });
		const pcm = Float32Array.from({ length: 4800 }, (_, frame) => (frame % 17 - 8) / 16);
		const writer = await sender.beginSourceWrite(source.storageKey, source); await writer.write([pcm]); await writer.commit();
		const archive = await runtime.exportScapeProject(project, sender); assert.ok(archive.blob);
		const saved: Blob[] = [];
		const fileService = { ...createAudioEditorFileService(),
			saveFile: async (request: { blob?: Blob; suggestedName?: string } = {}) => {
				assert.ok(request.blob instanceof Blob); saved.push(request.blob);
				return { method: 'node-fixture', fileName: request.suggestedName ?? 'Copy.sscape', size: request.blob.size };
			},
		};
		const environment = product === 'framescaper' ? await createFramescaperEditorProjectEnvironment({ storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		} }) : null;
		const controller = environment ? createFramescaperAudioEditorController(environment, { fileService })
			: (await controllerSession(context, { fileService, scapeProjectRuntime: runtime })).controller;
		if (environment) context.after(async () => { try { await controller.dispose(); } finally { await environment.close(); } });
		await controller.ready;
		await openWorkspaceProjectFile(controller, new File([archive.blob], name, { type: mimeType }),
			file => controller.actions.project.openScapeFile(file, () => 'copy'));
		const opened: unknown = controller.project;
		assert.ok(opened && typeof opened === 'object');
		assert.equal(Reflect.get(opened, 'id'), project.id); assert.equal(Reflect.get(opened, 'title'), 'Suffix custody');
		assert.equal(Reflect.get(opened, 'schemaFamily'), 'soundscaper');
		if (product === 'soundscaper') assert.ok(validateSoundscaperProject(opened));
		assert.equal(controller.getSnapshot().readOnly, product === 'framescaper');
		await controller.actions.project.saveScape({ saveCopy: true, useFileSystemAccess: false });
		assert.equal(saved.length, 1); const copied = saved[0]; assert.ok(copied);
		if (product === 'framescaper') assert.equal(createHash('sha256').update(new Uint8Array(await copied.arrayBuffer())).digest('hex'),
			createHash('sha256').update(new Uint8Array(await archive.blob.arrayBuffer())).digest('hex'), 'foreign Save copy must preserve every original byte');
		const recipient = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
		context.after(async () => { await recipient.close(); });
		const returned = await runtime.importScapeProject(copied, recipient); assert.equal(returned.readOnly, false);
		const returnedProject: unknown = returned.project; assert.ok(validateSoundscaperProject(returnedProject));
		assert.equal(returnedProject.title, 'Suffix custody'); assert.equal(returnedProject.sources.length, 1);
		const restored = returnedProject.sources[0]; assert.ok(restored?.kind === 'audio');
		assert.equal(restored.sampleRate, 48_000); assert.equal(restored.frameCount, 4800); assert.equal(restored.channelCount, 1);
		assert.deepEqual(returnedProject.clips.map(clip => [clip.title, clip.timelineStartFrame, clip.sourceStartFrame, clip.durationFrames]), [['Stored voice', 0, 0, 4800]]);
		assertPcmChannelsEqual(await readPcm(recipient, restored.storageKey), [[...pcm]], 'suffix handoff PCM');
	});
}
