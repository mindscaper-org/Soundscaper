/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { createRiffId3Chunk } from '../src/common/editor/id3-metadata.js';
import { createDesktopSelectedRangeBlob, retireDesktopSelectedRangeBlob, type DesktopSelectedRangeDescriptor } from '../src/common/editor/desktop-selected-range-blob.ts';
import { nativeOriginalImportFixture } from './helpers/native-original-import-fixture.ts';
import { riffMetadataReadView } from '../src/common/editor/riff-metadata-read-view.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { normalizeSourceProvenance } from '../src/common/editor/source-provenance.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { COPY, audioBuffer, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { readWavePcm } from './helpers/read-wave-pcm.ts';

// Actual FFmpeg 5.1.4 / @ffmpeg/core 0.12.10 outputs. Input: 4800 mono samples,
// sin(i*.1)*.2, 48 kHz s16 WAV (dither:false). Encode with adpcm_ima_wav,
// libmp3lame, or pcm_s16le and title/artist metadata. Headers are unmodified.
function recording(codec: string): Uint8Array<ArrayBuffer> {
	return new Uint8Array(Buffer.from(readFileSync(new URL(`./fixtures/ffmpeg-${codec}-info.wav.base64`, import.meta.url), 'utf8').trim(), 'base64'));
}

for (const codec of ['ima', 'mp3', 'pcm']) test(`${codec} WAV retains independent RIFF credits`, async () => {
	const bytes = recording(codec);
	const inspected = await inspectImportedMediaMetadata(new Blob([bytes]));
	assert.equal(inspected.metadata.normalized?.title, 'Harbour voices');
	assert.equal(inspected.metadata.normalized?.artist, 'Elodie field recording');
	assert.equal(inspected.metadata.raw?.ISFT, 'Lavf59.27.100');
	assert.deepEqual(inspected.warnings, []);
});

test('compressed WAV metadata preserves independent ID3 and skips encoded audio', async () => {
	const bytes = recording('mp3');
	const id3 = createRiffId3Chunk({ composer: 'Independent composer' });
	const input = new Uint8Array(bytes.length + id3.length); input.set(bytes); input.set(id3, bytes.length);
	new DataView(input.buffer).setUint32(4, input.length - 8, true);
	let offset = 12;
	while (new TextDecoder().decode(input.subarray(offset, offset + 4)) !== 'data') {
		const size = new DataView(input.buffer).getUint32(offset + 4, true); offset += 8 + size + size % 2;
	}
	const audioStart = offset + 8;
	const audioEnd = audioStart + new DataView(input.buffer).getUint32(offset + 4, true);
	const reads: Array<readonly [number, number]> = [];
	class TrackedFile extends File {
		override slice(start = 0, end = this.size, type?: string): Blob {
			reads.push([start, end]); return super.slice(start, end, type);
		}
	}
	const inspected = await inspectImportedMediaMetadata(new TrackedFile([input], 'compressed.wav'));
	assert.equal(inspected.metadata.normalized?.title, 'Harbour voices');
	assert.equal(inspected.metadata.raw?.TCOM, 'Independent composer');
	assert.deepEqual(inspected.warnings, []);
	assert.ok(reads.every(([start, end]) => end <= audioStart || start >= audioEnd));
});

test('compressed WAV metadata does not relax RIFF bounds or cancellation', async () => {
	const bytes = recording('mp3'); new DataView(bytes.buffer).setUint32(4, bytes.length, true);
	const invalid = await inspectImportedMediaMetadata(new Blob([bytes]));
	assert.deepEqual(invalid.metadata, {});
	assert.match(invalid.warnings[0]!, /container size is invalid/);
	const abort = new AbortController(); abort.abort();
	await assert.rejects(inspectImportedMediaMetadata(new Blob([recording('mp3')]), { signal: abort.signal }), { name: 'AbortError' });
});

for (const codec of ['pcm', 'mp3']) test(`native selected-range ${codec} metadata retains real payload bytes`, async () => {
	const file = new File([recording(codec)], `${codec}.wav`, { type: 'audio/wav' });
	const native = await nativeOriginalImportFixture(file);
	const choices = await native.bridge.chooseFiles({ purpose: 'audio', multiple: false }); assert.ok(Array.isArray(choices));
	const selected = createDesktopSelectedRangeBlob(choices[0] as DesktopSelectedRangeDescriptor, { fetch: native.fetch });
	try {
		const view = await riffMetadataReadView(selected, new Uint8Array(await selected.slice(0, 12).arrayBuffer()));
		assert.ok(view);
		const header = new DataView(await view.slice(0, 12).arrayBuffer());
		assert.equal(view.size, header.getUint32(4, true) + 8, 'metadata carrier must own every declared byte');
		assert.ok(Buffer.from(await view.arrayBuffer()).includes(Buffer.from('Harbour voices')), 'carrier must retain the selected metadata bytes');
		const inspected = await inspectImportedMediaMetadata(selected);
		assert.equal(inspected.metadata.normalized?.title, 'Harbour voices');
		assert.equal(inspected.metadata.normalized?.artist, 'Elodie field recording');
		assert.deepEqual(inspected.warnings, []);
	} finally { retireDesktopSelectedRangeBlob(selected); await native.close(); }
});

// Native codec samples remain covered by independent browser decode oracles.
// These decoder-port samples isolate metadata and durable PCM custody from codecs.
for (const codec of ['ima', 'mp3', 'pcm']) for (const desktop of codec === 'ima' ? [false] : [false, true]) {
	test(`${codec} ${desktop ? 'selected-range' : 'File'} credits and PCM survive controller import and Scape reopen`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const bytes = recording(codec), file = new File([bytes], `${codec}.wav`, { type: 'audio/wav' });
		const expected = codec === 'pcm' ? readWavePcm(bytes).channels
			: [Float32Array.from({ length: 4800 }, (_, frame) => (frame % 17 - 8) / 64)];
		const native = desktop ? await nativeOriginalImportFixture(file) : null;
		const fileService = native ? createAudioEditorFileService({ bridge: {
			chooseFiles: native.bridge.chooseFiles, releaseRead: native.bridge.releaseRead,
		}, fetch: native.fetch }) : undefined;
		const runtime = createSoundscaperProjectRuntimeSelection();
		const store = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
		const recipient = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
		let decodes = 0;
		const engine = { ...createMemoryEngine(), decodeAudioData: async () => {
			decodes += 1; return audioBuffer(expected.map(channel => channel.slice()), 48_000);
		} };
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(), ...(fileService ? { fileService } : {}),
			engine: engine as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); await recipient.close(); await native?.close(); });
		await controller.ready;
		if (fileService) {
			const choices = await fileService.chooseFiles({ purpose: 'audio', multiple: false });
			assert.equal(choices.length, 1); assert.equal(choices[0].readProfile, 'selected-range-v1');
			await fileService.withReadDescriptors(choices, {}, async (files: readonly File[]) => {
				await controller.actions.project.importFiles(files);
			});
		} else await controller.actions.project.importFiles([file]);
		assert.equal(decodes, codec === 'pcm' ? 0 : 1);
		const project: unknown = controller.project; assert.ok(validateSoundscaperProject(project));
		assert.equal(project.sources.length, 1); assert.equal(project.clips.length, 1);
		const archive = createSoundscaperScapeNativeRuntime();
		const exported = await archive.exportScapeProject(project, store); assert.ok(exported.blob);
		const reopened = await archive.importScapeProject(exported.blob, recipient);
		assert.equal(reopened.readOnly, false);
		const restored: unknown = reopened.project; assert.ok(validateSoundscaperProject(restored));
		assert.equal(restored.sources.length, 1); assert.equal(restored.clips.length, 1);
		const source = restored.sources[0]; assert.ok(source?.kind === 'audio');
		assert.equal(source.sampleRate, 48_000); assert.equal(source.frameCount, 4800); assert.equal(source.channelCount, 1);
		const contribution = normalizeSourceProvenance(source.provenance).contributions[0]; assert.ok(contribution);
		assert.equal(contribution.metadata.normalized.title, 'Harbour voices');
		assert.equal(contribution.metadata.normalized.artist, 'Elodie field recording');
		assert.equal(contribution.metadata.raw.ISFT, 'Lavf59.27.100');
		assert.ok(contribution.origin?.kind === 'local-file');
		assert.equal(contribution.origin.originalFileName, file.name);
		assert.equal(contribution.origin.byteLength, file.size);
		const samples: number[] = [];
		for await (const chunk of recipient.readSourceChunks(source.storageKey)) samples.push(...chunk.channels[0]);
		assert.deepEqual(Float32Array.from(samples), expected[0]);
	});
}
