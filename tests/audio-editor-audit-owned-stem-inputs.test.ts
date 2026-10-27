/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createAudioEditorSignalRenderer } from '../src/common/editor/signal-generator-renderer.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore, audioBuffer } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

test('actual owned stem export serializes immutable inputs once while every WAV remains exact', async context => {
	context.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 25) });
	const rate = 48_000, frames = 4_096, stems = 6;
	const generated = createAudioEditorSignalRenderer('chirp', { sampleRate: rate, channelCount: 2, durationSeconds: frames / rate,
		startFrequency: 160, endFrequency: 4_900 }).next(frames);
	assert.ok(generated);
	const metadata = { title: 'Stem input fence', lyrics: 'la '.repeat(2_000) };
	const project = createSoundscaperProject({ id: 'stem-input-fence', title: 'Stem input fence', sampleRate: rate,
		sources: [{ id: 'audio', storageKey: 'audio', name: 'Chirp', mimeType: 'audio/wav', frameCount: frames, channelCount: 2, sampleRate: rate }],
		clips: Array.from({ length: stems }, (_, index) => ({ id: `clip-${index}`, sourceId: 'audio', sourceDurationFrames: frames, durationFrames: frames })),
		tracks: Array.from({ length: stems }, (_, index) => ({ id: `track-${index}`, name: `Stem ${index}`, clipIds: [`clip-${index}`] })),
	});
	const chunks: Uint8Array<ArrayBuffer>[] = [];
	let renders = 0, commits = 0, serializations = 0;
	const target = { name: 'stems.zip', async createWritable() { return {
		async write(chunk: Uint8Array) { await new Promise<void>(resolve => setImmediate(resolve)); chunks.push(new Uint8Array(chunk)); },
		close() { commits++; }, abort() {},
	}; } };
	const fileService = createAudioEditorFileService({ scope: { showSaveFilePicker: async () => target, URL }, bridge: null, document: null });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'owned-stem-input-regression' });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controllerOptions = { headless: true, locale: 'en', copy: COPY, productId: 'soundscaper', store, fileService,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), engine: createMemoryEngine(), ffmpeg: createMemoryFfmpeg(),
		engineFactory() { return { setSourceResolver(): unknown { return this; }, loadProject() {},
			async renderMix(range: { outputFrames: number; onProgress?(value: number): void }) {
				renders++; range.onProgress?.(0); await new Promise<void>(resolve => setImmediate(resolve)); range.onProgress?.(1);
				return audioBuffer(generated.map(channel => channel.slice(0, range.outputFrames)), rate);
			}, async dispose() {},
		}; },
	};
	// The established headless harness implements the export-facing subset of browser engine/codec ports.
	const controller = createAudioEditorController(null,
		controllerOptions as unknown as NonNullable<Parameters<typeof createAudioEditorController>[1]>);
	try {
		const writer = await store.beginSourceWrite('audio', project.sources[0]);
		await writer.write(generated); await writer.commit(); await store.saveProject(project);
		await controller.ready; await controller.actions.project.openById(project.id);
		await controller.actions.preferences.update({ performance: { optimizeFor: 'speed' } });
		const stringify = JSON.stringify;
		Object.defineProperty(JSON, 'stringify', { configurable: true, writable: true, value(...args: unknown[]) {
			const value = args[0];
			if (Array.isArray(value) && value.length === 4 && value[0] && typeof value[0] === 'object'
				&& (value[0] as { mode?: unknown }).mode === 'stems') serializations++;
			return Reflect.apply(stringify, JSON, args) as string | undefined;
		} });
		try {
			assert.ok(await controller.actions.export.start({ mode: 'stems', format: 'wav', bitDepth: 24, sampleRate: rate,
				dither: 'none', includeTail: false, metadata }), controller.getSnapshot().status.message);
		} finally { Object.defineProperty(JSON, 'stringify', { configurable: true, writable: true, value: stringify }); }
		const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
		let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
		const zip = new ZipReader(new Uint8ArrayReader(output), { useWebWorkers: false });
		try {
			const entries = await zip.getEntries(); assert.equal(entries.length, stems);
			const expected = createHash('sha256').update(encodeWav(generated, { sampleRate: rate, bitDepth: 24, dither: 'none', metadata })).digest('hex');
			for (const entry of entries) {
				assert.ok(!entry.directory && entry.getData);
				assert.equal(createHash('sha256').update(await entry.getData(new Uint8ArrayWriter())).digest('hex'), expected, entry.filename);
			}
		} finally { await zip.close(); }
		assert.equal(renders, stems); assert.equal(commits, 1);
		assert.equal(serializations, 1);
	} finally { await controller.dispose(); }
});
