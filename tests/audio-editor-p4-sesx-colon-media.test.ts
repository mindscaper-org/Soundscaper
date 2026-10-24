/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ReadCapabilityStore } from '../desktop/file-capabilities.js';
import { SesxMediaSessionStore } from '../desktop/sesx-media-session.mjs';
import type { NativeProjectFileService, NativeSesxReadDescriptor } from '../src/common/editor/controller/document/native-project-types.ts';
import { registerDesktopReadCapability } from '../src/common/editor/desktop-read-capability-registry.ts';
import { escapeXml } from '../src/common/editor/dawproject-xml.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { openWorkspaceProjectFile } from '../src/common/editor/ui/workspace/open-workspace-project-file.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;

for (const [reference, location] of [
	['Room:wet.wav', 'relativePath'], ['Audio:Dry/take.wav', 'relativePath'],
	['/old/Room:wet.wav', 'absolutePath'], ['Audio/take.wav', 'relativePath'],
] as const) test(`desktop SESX File Open resolves exact confined media ${reference}`, async context => {
	const directory = await mkdtemp(join(tmpdir(), 'p4-sesx-colon-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const actual = location === 'absolutePath' ? 'Room:wet.wav' : reference;
	const mediaPath = join(directory, actual); await mkdir(dirname(mediaPath), { recursive: true });
	const samples = Float32Array.from({ length: 480 }, (_value, index) => index % 2 ? -.125 : .25);
	await writeFile(mediaPath, encodeWav([samples], { sampleRate: 48_000, float: true }));
	// A basename fallback must never choose this different, healthy recording.
	if (actual.includes('/')) await writeFile(join(directory, 'take.wav'), encodeWav([new Float32Array(480).fill(.75)], { sampleRate: 48_000, float: true }));
	const xml = `<sesx><session sampleRate="48000" audioChannelType="mono"><tracks><audioTrack>
	<audioClip fileID="0" startPoint="0" endPoint="480" sourceInPoint="0" sourceOutPoint="480"/>
	</audioTrack></tracks></session><files><file id="0" ${location}="${escapeXml(reference)}"/></files></sesx>`;
	const sessionPath = join(directory, 'Session.sesx'); await writeFile(sessionPath, xml);
	const owner = {}, reads = new ReadCapabilityStore(); context.after(() => reads.dispose());
	let folderPrompts = 0;
	const sessions = new SesxMediaSessionStore({ readCapabilities: reads,
		dialog: { showOpenDialog: async () => { folderPrompts++; return { canceled: true, filePaths: [] }; } }, windowFor: () => null });
	context.after(() => { sessions.dispose(); });
	const selected = await reads.registerSelectedRangePath(sessionPath, { owner });
	await sessions.registerSelection(selected.id, sessionPath, { owner });
	const paths: string[] = [];
	const fileService = { ...createAudioEditorFileService({ bridge: null }), isDesktop: true,
		async resolveSesxMedia(request: { sessionReadId: string; relativePath: string; mediaRootId?: string }) {
			paths.push(request.relativePath);
			return await sessions.resolve({ ...request, owner }) as Awaited<ReturnType<NonNullable<NativeProjectFileService['resolveSesxMedia']>>>;
		},
		chooseSesxMediaFolder: (request: { sessionReadId: string }) => sessions.chooseFolder({ ...request, owner }),
		releaseSesxSession: (id: string) => Promise.resolve(sessions.release(id, { owner })),
		async withReadDescriptors<Value>(descriptors: readonly NativeSesxReadDescriptor[], _options: { signal?: AbortSignal }, consume: (blobs: readonly Blob[]) => PromiseLike<Value> | Value) {
			try { return await consume(await Promise.all(descriptors.map(async ({ id }) => {
				const grant = await reads.resolveHelperGrant(id, { owner }); assert.ok(grant);
				return new Blob([Uint8Array.from(await readFile(grant.path))]);
			}))); } finally { for (const { id } of descriptors) await reads.release(id, { owner }); }
		},
	} satisfies NativeProjectFileService;
	const file = new File([xml], 'Session.sesx'); registerDesktopReadCapability(file, selected.id);
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY, store,
		fileService: fileService as unknown as Options['fileService'], projectRuntime: runtime, sessionController: runtime.createSessionController(),
		adaptAudacityProject: importSoundscaperAudacityProject,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await openWorkspaceProjectFile(controller, file, () => { throw new Error('Unexpected native archive.'); }, undefined, true);
	const project: unknown = controller.project; assert.ok(validateSoundscaperProject(project));
	assert.equal(project.clips.length, 1, 'the adjacent authorized recording must remain playable');
	const source = project.sources[0]; assert.ok(source?.kind === 'audio');
	const stored = await store.readSourceChunk(source.storageKey, 0); assert.ok(stored);
	assert.deepEqual(stored.channels[0], samples, 'the session must use its referenced recording rather than a basename decoy');
	assert.deepEqual(paths, [actual], 'lookup must preserve the exact local filename and directory');
	assert.equal(folderPrompts, 0);
	await controller.actions.project.flush();
	const saved: unknown = await store.loadProject(project.id); assert.ok(validateSoundscaperProject(saved));
	assert.deepEqual(saved.sources, project.sources); assert.deepEqual(saved.clips, project.clips);
});
