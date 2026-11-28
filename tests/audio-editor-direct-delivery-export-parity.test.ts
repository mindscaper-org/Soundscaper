/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorExportService } from '../src/common/editor/controller/export/internal/export-service.ts';
import { createDeferredEditorExportService } from '../src/common/editor/controller/export/deferred-export-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { encodeWav } from '../src/common/editor/wav.js';
import {
	createDirectPcmExportFixture,
	createPreparedStream,
	directPlan,
} from './helpers/direct-pcm-export-fixture.ts';

const DESKTOP_TARGET = Object.freeze({ id: '7'.repeat(48), name: 'mix.wav' });
const WRITE = '8'.repeat(48);

test('direct export publishes the same PCM and report through the desktop file service', async () => {
	const staged = encodeWav([Float32Array.of(0.25, -0.5), Float32Array.of(-0.75, 0.125)], {
		sampleRate: 48_000, bitDepth: 24, float: false, dither: 'none', metadata: {}, markers: [],
	});
	const plan = directPlan({
		cart: null, ixml: null, markers: [], metadata: {},
		outputFileBytesPerRender: staged.byteLength,
	} as never);
	const fixtureOptions = {
		encoderFinalByteLength: staged.byteLength,
		encoderInitialChunks: [staged], encoderWriteChunks: () => [new Uint8Array(0)], encoderFinalChunks: [],
	};
	const directFixture = createDirectPcmExportFixture(plan, fixtureOptions);
	const directDestination = createPreparedStream({ publishedFileName: 'mix.wav' });
	directFixture.setPrepared(directDestination.prepared);
	const direct = createEditorExportService(directFixture.runtime);
	const directOutcome = await direct.handleExportAction('start', {
		saveTarget: { id: 'direct-target' }, useFileSystemAccess: true,
	});
	assert.equal(directFixture.errors.length, 0, String(directFixture.errors[0]));

	const desktopFixture = createDirectPcmExportFixture(plan, fixtureOptions);
	const written: Uint8Array[] = [];
	let offset = 0;
	const desktopBridge = {
		async beginWrite(request: Readonly<{ targetId: string }>) {
			assert.equal(request.targetId, DESKTOP_TARGET.id);
			return { writeId: WRITE, chunkSize: 4 * 1024 * 1024 };
		},
		async writeChunk(request: Readonly<{ writeId: string; offset: number; bytes: Uint8Array }>) {
			assert.equal(request.writeId, WRITE);
			assert.equal(request.offset, offset);
			written.push(request.bytes.slice());
			offset += request.bytes.byteLength;
			return { nextOffset: offset };
		},
		async patchFinalPrefix(request: Readonly<{ writeId: string; bytes: Uint8Array }>) {
			assert.equal(request.writeId, WRITE);
			written[0]?.set(request.bytes);
			return { byteLength: offset };
		},
		async finishWrite(writeId: string) {
			assert.equal(writeId, WRITE);
			return { byteLength: offset };
		},
		async abortWrite() { throw new Error('The successful desktop export did not expect to abort.'); },
	};
	const desktopProgress: number[] = [];
	type ProgressRequest = Readonly<{ onProgress?: (event: Readonly<{ progress: number }>) => void }>;
	const createRenderEngine = desktopFixture.runtime.createCacheAwareRenderEngine as () => {
		renderMixRealtime(request: ProgressRequest): Promise<unknown>;
	};
	const getProject = desktopFixture.runtime.getProject as () => Readonly<{ id: string }>;
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate(getProject().id);
	const desktopRuntime = {
		...desktopFixture.runtime,
		lifetime,
		projectGeneration,
		createCacheAwareRenderEngine: () => {
			const engine = createRenderEngine();
			return {
				...engine,
				async renderMixRealtime(request: ProgressRequest) {
					request.onProgress?.({ progress: 0.4 });
					return engine.renderMixRealtime(request);
				},
			};
		},
		taskProgress: {
			begin: () => ({ setPhase: () => true, finish: () => true }),
			getSnapshot: () => ({ kind: 'export' }), updateActive: () => true,
		},
		updateExportProgress: (progress: number) => { desktopProgress.push(progress); },
		fileService: createAudioEditorFileService({
			bridge: desktopBridge,
			document: null,
			urlApi: {},
		}),
	};
	const desktop = createDeferredEditorExportService({
		...desktopRuntime,
		getProject,
		options: desktopFixture.runtime.options,
		sourceBuffers: desktopFixture.runtime.sourceBuffers,
		prepareCommittedTimePitchCaches: desktopFixture.runtime.prepareCommittedTimePitchCaches,
		throwIfAborted: desktopFixture.runtime.throwIfAborted,
	});
	const desktopOutcome = await desktop.handleExportAction('start', {
		saveTarget: DESKTOP_TARGET, useFileSystemAccess: true,
	});
	assert.equal(desktopFixture.errors.length, 0, String(desktopFixture.errors[0]));

	assert.deepEqual(concat(directDestination.chunks), staged);
	assert.deepEqual(concat(written), staged);
	assert.ok(desktopProgress.includes(0.4), 'ordinary render progress reaches the export presentation');
	assert.equal((directOutcome as { fileName: string }).fileName, (desktopOutcome as { fileName: string }).fileName);
	assert.equal((directOutcome as { size: number }).size, (desktopOutcome as { size: number }).size);
	assert.ok('deliveryReport' in directFixture.state && directFixture.state.deliveryReport);
	assert.ok('deliveryReport' in desktopFixture.state);
	assert.deepEqual(desktopFixture.state.deliveryReport, directFixture.state.deliveryReport);
});

function concat(chunks: readonly Uint8Array[]): Uint8Array {
	const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
	const result = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
	return result;
}
