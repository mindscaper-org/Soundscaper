/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadBundledFlacAudioCodecRuntime } from '../desktop/bundled-flac-audio-codec-runtime.ts';
import { createDesktopAudioCodecRuntimeComposition } from '../desktop/desktop-audio-codec-runtime-composition.ts';
import type { DesktopAudioCodecProviderExecutionResult } from '../desktop/desktop-audio-codec-broker.ts';
import { deriveDesktopAudioCodecOperation } from '../desktop/desktop-audio-codec-broker.ts';
import type { DesktopAudioCodecCapabilityQuery } from '../desktop/desktop-audio-codec-capability-contract.ts';
import { encodeDedicatedAudioPcm } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { registerDesktopOriginalFile } from '../src/common/editor/desktop-original-file-port.ts';
import { createOriginalFileOverwriteMenuItems } from '../src/common/editor/ui/original-file-overwrite-menu.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { createAudioEditorController, createMemoryEngine, createTwoTrackFixture, ENGLISH_COPY, storedChannel } from './helpers/audio-editor-multitrack-selection-harness.js';

function flac16(): Uint8Array<ArrayBuffer> {
	// A complete128-frame constant16bit FLAC, independently accepted by pinned libFLAC below.
	return Uint8Array.from(Buffer.from('664c6143800000220080008000000c00000c0bb800f000000080b144c4b394fd9cffe78c33f19d64a161fff86a08007f5d002000c418', 'hex'));
}

for (const [bitDepth, externalAdmitted] of [[16, false], [24, false], [16, true]] as const) test(`desktop File Import checks Original ${bitDepth}bit FLAC admission (${externalAdmitted ? 'configured provider' : 'bundled only'})`, async () => {
	const bundled = await loadBundledFlacAudioCodecRuntime({ target: 'linux-x64' });
	assert.ok(bundled);
	const pcm = new Float32Array(128).fill(.25);
	const bytes = bitDepth === 16 ? flac16() : await encodeDedicatedAudioPcm({ format: 'flac', input: new Uint8Array(pcm.buffer),
		frameCount: pcm.length, sampleRate: 48_000, channelCount: 1, settings: { compressionLevel: 5 }, maximumOutputBytes: 1024 ** 2 },
	{ loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
	const decodeRequest = { operation: 'audio-decode' as const, format: 'flac' as const,
		input: bytes, sampleRate: null, channelCount: null, settings: { sampleFormat: 'f32le' as const }, maximumOutputBytes: 1024 ** 2 };
	const decoded = await bundled.execute(decodeRequest, { operation: deriveDesktopAudioCodecOperation(decodeRequest) }) as DesktopAudioCodecProviderExecutionResult;
	assert.equal(decoded.status, 'executed', 'the shipping qualified desktop decoder accepts the original');
	const service = createDesktopAudioCodecRuntimeComposition({ target: 'linux-x64', scratchRoot: '/tmp/next-original-codec',
		createBundledRuntime: () => bundled,
		externalFfmpegPreferences: { admission: () => null, invalidateAdmission: async () => { throw new Error('No external provider configured'); } } });
	const tuple = { operation: 'audio-encode' as const, format: 'flac' as const, sampleRate: 48_000, channelCount: 1,
		settings: { bitDepth, compressionLevel: 5 } };
	const capabilities = await service.capabilities({ schemaVersion: 2, operations: [tuple] });
	assert.equal(capabilities.capabilities[0]?.available, bitDepth === 24, 'use the actual reviewed desktop provider admission');
	const queries: DesktopAudioCodecCapabilityQuery[] = [];
	const codec = { dispose() {}, async desktopAudioCodecCapabilities(query: DesktopAudioCodecCapabilityQuery) {
		queries.push(query);
		const result = await service.capabilities(query);
		return externalAdmitted ? { ...result, capabilities: result.capabilities.map(entry => ({ ...entry,
			available: true as const, provider: 'external-ffmpeg' as const, reason: null })) } : result;
	} };
	const { store } = await createTwoTrackFixture(`next-original-${bitDepth}`, new Map<string, Float32Array>(), 48_000);
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en', store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: codec as unknown as Options['ffmpeg'],
		fileService: { originalOverwriteAvailable: true, releaseOriginalFile() {} } as unknown as Options['fileService'] });
	const file = new File([bytes], 'Original.flac', { type: 'audio/flac' });
	let releases = 0;
	registerDesktopOriginalFile(file, { id: 'e'.repeat(48), name: file.name }, () => { releases += 1; });
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => input instanceof URL && input.protocol === 'file:'
		? new Response(Uint8Array.from(await readFile(input))) : originalFetch(input, init);
	try {
		await controller.ready;
		// The renderer-side decode fixture uses the same pinned libFLAC; native Chromium handles FLAC in Electron.
		await controller.actions.project.importFiles([file], { destination: 'timeline' });
		const project = controller.getSnapshot().project;
		assert.ok(validateAudioEditorProjectV17(project));
		assert.equal(project.sources.length, 1);
		assert.deepEqual(await storedChannel(store, project.sources[0]!.id, 0), pcm);
		assert.equal(controller.actions.export.overwriteOriginalAvailable(), bitDepth === 24 || externalAdmitted,
			'Original must not offer a guaranteed unsupported overwrite');
		const [menu] = createOriginalFileOverwriteMenuItems({ originalFile: controller.actions.export.originalFile,
			available: controller.actions.export.overwriteOriginalAvailable, overwrite: controller.actions.export.overwriteOriginal },
		{ copy: ENGLISH_COPY, blocked: false, recording: false, importing: false, materialAvailable: true });
		assert.equal(menu?.disabled, !(bitDepth === 24 || externalAdmitted));
		assert.equal(queries.length, 1);
		assert.deepEqual(queries[0]?.operations, [tuple]);
		assert.equal(releases, bitDepth === 16 && !externalAdmitted ? 1 : 0);
	} finally { await controller.dispose(); globalThis.fetch = originalFetch; }
});

test('uncompressed Original admission never queries a desktop encoder provider', async () => {
	const { createDesktopOriginalImportRecorder, desktopOriginalForProject, resetDesktopOriginal } = await import('../src/common/editor/desktop-overwrite-original.ts');
	const { encodeWav } = await import('../src/common/editor/wav.js');
	const state = {};
	let project: { id: string; sources: readonly object[]; clips: readonly object[] } = { id: 'pcm', sources: [], clips: [] };
	const file = new File([new Uint8Array(encodeWav([new Float32Array(128)], { sampleRate: 48_000, bitDepth: 16 }))], 'PCM.wav');
	registerDesktopOriginalFile(file, { id: 'a'.repeat(48), name: file.name });
	await createDesktopOriginalImportRecorder({ state, getProject: () => project,
		codecRuntime: { desktopAudioCodecCapabilities() { throw new Error('PCM must not probe compressed providers'); } } }, async () => {
		project = { ...project, sources: [{ id: 'source', kind: 'audio', channelCount: 1 }], clips: [{ id: 'clip' }] };
	})(file);
	assert.equal(desktopOriginalForProject(state, project.id)?.settings.format, 'wav');
	resetDesktopOriginal(state);
});

test('an obsolete successful capability response cannot restore retired Original write authority', async () => {
	const { createDesktopOriginalImportRecorder, desktopOriginalForProject, resetDesktopOriginal } = await import('../src/common/editor/desktop-overwrite-original.ts');
	const state = {};
	let project: { id: string; sources: readonly object[]; clips: readonly object[] } = { id: 'pending', sources: [], clips: [] };
	let notifyRequested!: () => void;
	let allowAdmission!: () => void;
	const requested = new Promise<void>(resolve => { notifyRequested = resolve; });
	const admitted = new Promise<void>(resolve => { allowAdmission = resolve; });
	let releases = 0;
	const file = new File([flac16()], 'Pending.flac');
	registerDesktopOriginalFile(file, { id: 'b'.repeat(48), name: file.name }, () => { releases += 1; });
	const pending = createDesktopOriginalImportRecorder({ state, getProject: () => project,
		codecRuntime: { async desktopAudioCodecCapabilities(query: DesktopAudioCodecCapabilityQuery) {
			notifyRequested(); await admitted;
			return { schemaVersion: 2, capabilities: query.operations.map(operation => ({ ...operation,
				available: true, provider: 'external-ffmpeg', reason: null })) };
		} } }, async () => {
		project = { ...project, sources: [{ id: 'source', kind: 'audio', channelCount: 1, sampleRate: 48_000 }], clips: [{ id: 'clip' }] };
	})(file);
	await requested;
	resetDesktopOriginal(state);
	allowAdmission();
	await pending;
	assert.equal(desktopOriginalForProject(state, project.id), null);
	assert.equal(releases, 1);
});
