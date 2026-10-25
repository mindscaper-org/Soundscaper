/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadCapabilityStore } from '../desktop/file-capabilities.js';
import { SesxMediaSessionStore } from '../desktop/sesx-media-session.mjs';
import { acceptsFile, mimeTypeForPath, validateFileChoice } from '../desktop/validation.js';
import { readProfileForSelectedPath } from '../desktop/read-selection-service.js';
import type { NativeProjectFileService, NativeSesxReadDescriptor } from '../src/common/editor/controller/document/native-project-types.ts';
import { registerDesktopReadCapability } from '../src/common/editor/desktop-read-capability-registry.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { openWorkspaceProjectFile } from '../src/common/editor/ui/workspace/open-workspace-project-file.ts';
import { createDawprojectAudioPreparer } from '../src/common/editor/controller/import/dawproject-audio-decode.ts';
import { resolveMediaImportVideoRoute } from '../src/common/editor/controller/import/internal/media-import-video-route.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { nativeQuickTimePcmFixture } from './helpers/quicktime-pcm-audio-fixture.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const format of ['sowt', 'twos', 'wav'] as const) test(`desktop SESX File Open retains its genuine adjacent ${format} recording`, async context => {
	const directory = await mkdtemp(join(tmpdir(), 'p4-sesx-quicktime-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const codec = { ...createMemoryFfmpeg(), decode: () => Promise.reject(new Error('QuickTime PCM must use its existing packet decoder.')) };
	const original = format === 'wav' ? new File([Uint8Array.from(encodeWav([new Float32Array(4800).fill(.25)], { sampleRate: 48_000, float: true }))], 'Control.wav', { type: 'audio/wav' })
		: nativeQuickTimePcmFixture(format);
	const expected: Float32Array[][] = [];
	if (format !== 'wav') {
		assert.equal(await resolveMediaImportVideoRoute(original, true), false, 'an audio-only QuickTime recording stays on the audio route');
		const prepared = await createDawprojectAudioPreparer(codec)(original, original.name, new AbortController().signal);
		try { await prepared.stream({ chunkFrames: 8192, onChunk: async channels => { expected.push(channels.map(channel => channel.slice())); } }); }
		finally { prepared.dispose(); }
	} else expected.push([new Float32Array(4800).fill(.25)]);
	const path = join(directory, 'Audio', original.name); await mkdir(join(directory, 'Audio'));
	await writeFile(path, new Uint8Array(await original.arrayBuffer()));
	const xml = `<sesx><session sampleRate="48000" audioChannelType="stereo"><tracks><audioTrack>
	<audioClip fileID="0" startPoint="0" endPoint="4800" sourceInPoint="0" sourceOutPoint="4800"/>
	</audioTrack></tracks></session><files><file id="0" relativePath="Audio/${original.name}"/></files></sesx>`;
	const sessionPath = join(directory, 'Session.sesx'); await writeFile(sessionPath, xml);
	const owner = {}, reads = new ReadCapabilityStore(); context.after(() => reads.dispose());
	let prompts = 0;
	const sessions = new SesxMediaSessionStore({ readCapabilities: reads,
		dialog: { showOpenDialog: async () => { prompts++; return { canceled: true, filePaths: [] }; } }, windowFor: () => null });
	context.after(() => { sessions.dispose(); });
	const selected = await reads.registerSelectedRangePath(sessionPath, { owner });
	await sessions.registerSelection(selected.id, sessionPath, { owner });
	const fileService = { ...createAudioEditorFileService({ bridge: null }), isDesktop: true,
		async resolveSesxMedia(request: { sessionReadId: string; relativePath: string; mediaRootId?: string }) {
			return await sessions.resolve({ ...request, owner }) as Awaited<ReturnType<NonNullable<NativeProjectFileService['resolveSesxMedia']>>>;
		},
		chooseSesxMediaFolder: (request: { sessionReadId: string }) => sessions.chooseFolder({ ...request, owner }),
		releaseSesxSession: (id: string) => Promise.resolve(sessions.release(id, { owner })),
		async withReadDescriptors<Value>(descriptors: readonly NativeSesxReadDescriptor[], _options: { signal?: AbortSignal }, consume: (blobs: readonly Blob[]) => PromiseLike<Value> | Value) {
			try { return await consume(await Promise.all(descriptors.map(async ({ id, mimeType }) => {
				assert.equal(mimeType, format === 'wav' ? 'audio/wav' : 'video/quicktime');
				const grant = await reads.resolveHelperGrant(id, { owner }); assert.ok(grant); assert.equal(grant.path, path);
				return new Blob([Uint8Array.from(await readFile(grant.path))], { type: original.type });
			}))); } finally { for (const { id } of descriptors) await reads.release(id, { owner }); }
		},
	} satisfies NativeProjectFileService;
	const file = new File([xml], 'Session.sesx'); registerDesktopReadCapability(file, selected.id);
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY, store,
		fileService: fileService as unknown as Options['fileService'], projectRuntime: runtime, sessionController: runtime.createSessionController(),
		adaptAudacityProject: importSoundscaperAudacityProject, engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: codec as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await openWorkspaceProjectFile(controller, file, () => { throw new Error('Unexpected native archive.'); }, undefined, true);
	const project: unknown = controller.project; assert.ok(validateSoundscaperProject(project));
	assert.equal(project.clips.length, 1, 'a genuine recording already decoded by the maintained preparer must not be reported missing');
	const source = project.sources[0]; assert.ok(source?.kind === 'audio');
	assert.equal(source.frameCount, 4800); assert.equal(source.sampleRate, 48_000); assert.equal(prompts, 0);
	assert.equal(source.mimeType, format === 'wav' ? 'audio/wav' : 'video/quicktime');
	const stored = await store.readSourceChunk(source.storageKey, 0); assert.ok(stored);
	assertPcmChannelsEqual(stored.channels, expected[0]!);
	await controller.actions.project.flush();
	const saved: unknown = await store.loadProject(project.id); assert.ok(validateSoundscaperProject(saved));
	assert.deepEqual(saved.sources, project.sources); assert.deepEqual(saved.clips, project.clips);
});

test('native QuickTime admission keeps chooser, MIME and confined SESX read authority consistent', async context => {
	for (const purpose of ['project', 'media', 'audio-video', 'video']) {
		assert.equal(acceptsFile(purpose, '/selected/Recording.MOV'), true, purpose);
		assert.ok(validateFileChoice({ purpose }).filters.some((filter: { extensions: readonly string[] }) => filter.extensions.includes('mov')));
		assert.equal(readProfileForSelectedPath(purpose, '/selected/Recording.MOV'), 'selected-range-v1');
		assert.equal(acceptsFile(purpose, '/selected/Recording.mov.exe'), false);
	}
	assert.equal(mimeTypeForPath('/selected/Recording.MOV'), 'video/quicktime');
	const directory = await mkdtemp(join(tmpdir(), 'p4-mov-authority-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const folder = join(directory, 'selected'); await mkdir(folder);
	const sessionPath = join(folder, 'Session.sesx'); await writeFile(sessionPath, '<sesx/>');
	const bytes = new Uint8Array(await nativeQuickTimePcmFixture('sowt').arrayBuffer());
	await writeFile(join(folder, 'Recording.mov'), bytes);
	await writeFile(join(folder, 'Recording.mov.exe'), bytes);
	await writeFile(join(directory, 'Outside.mov'), bytes);
	await symlink(join(directory, 'Outside.mov'), join(folder, 'Escaped.mov'));
	const owner = {}, reads = new ReadCapabilityStore(); context.after(() => reads.dispose());
	const selected = await reads.registerSelectedRangePath(sessionPath, { owner });
	const sessions = new SesxMediaSessionStore({ readCapabilities: reads,
		dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }, windowFor: () => null });
	context.after(() => { sessions.dispose(); }); await sessions.registerSelection(selected.id, sessionPath, { owner });
	const result: unknown = await sessions.resolve({ sessionReadId: selected.id, relativePath: 'Recording.mov', owner });
	assert.ok(result && typeof result === 'object' && 'status' in result && result.status === 'found' && 'descriptor' in result);
	assert.ok(result.descriptor && typeof result.descriptor === 'object' && 'id' in result.descriptor && typeof result.descriptor.id === 'string');
	assert.equal((await reads.resolveHelperGrant(result.descriptor.id, { owner }))?.path, join(folder, 'Recording.mov'));
	for (const relativePath of ['Escaped.mov', 'Recording.mov.exe']) {
		assert.deepEqual(await sessions.resolve({ sessionReadId: selected.id, relativePath, owner }), { status: 'missing' });
	}
	await assert.rejects(sessions.resolve({ sessionReadId: selected.id, relativePath: '../Outside.mov', owner }), /relative|path|traversal/iu);
	await assert.rejects(sessions.resolve({ sessionReadId: selected.id, relativePath: 'Recording.mov', owner: {} }), /session/iu);
	assert.equal(await reads.release(result.descriptor.id, { owner }), true);
	assert.equal(sessions.release(selected.id, { owner }), true);
	await assert.rejects(sessions.resolve({ sessionReadId: selected.id, relativePath: 'Recording.mov', owner }), /session/iu);
});
