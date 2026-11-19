/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { encodeDedicatedAudioPcm } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { encodeBrowserAudioFileStreamed } from '../src/common/editor/browser-audio-streamed-encode.ts';
import { openDedicatedAudioEncodeSession } from '../src/common/editor/dedicated-audio-encode-session.ts';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { createMediaExportCapabilities } from '../src/common/editor/media-export.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { resolveDesktopOriginalExportSettings } from '../src/common/editor/desktop-original-export-settings.ts';
import { leadingId3AudioOffset } from '../src/common/editor/leading-id3-tags.ts';
import { createAudioMetadataId3Tag } from '../src/common/editor/id3-metadata.js';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { exportDialogMetadata, normalizeExportDialogAudioSettings } from '../src/common/editor/ui/export-dialog-audio-codec-options.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import { exportDialogMetadataFields } from '../src/common/editor/ui/export-dialog-metadata-fields.ts';
import { createController, createTwoTrackFixture, storedChannel } from './helpers/audio-editor-multitrack-selection-harness.js';
import { importAndReopenAudio } from './helpers/audio-import-archive-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { createReviewedAudioCodecRuntime, useLocalAudioCodecPayloads } from './helpers/reviewed-audio-codec-runtime.ts';

async function recording(): Promise<Uint8Array<ArrayBuffer>> {
	const pcm = Float32Array.from({ length: 48_001 }, (_, index) => Math.sin(index * .03) * .1);
	return encodeDedicatedAudioPcm({ format: 'mp3', input: new Uint8Array(pcm.buffer), frameCount: pcm.length,
		sampleRate: 48_000, channelCount: 1, settings: { bitrateKbps: 128 }, maximumOutputBytes: 1024 ** 2 },
	{ loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
}

test('File Open keeps the MP3 gapless range after consecutive leading ID3 tags', async () => {
	const encoded = await recording();
	const tags = [createAudioMetadataId3Tag({ title: 'Session title' }), createAudioMetadataId3Tag({ artist: 'Session artist' })];
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (value, init) => value instanceof URL && value.protocol === 'file:'
		? new Response(Uint8Array.from(await readFile(value))) : originalFetch(value, init);
	const { store } = await createTwoTrackFixture('next-mp3-consecutive-tags', new Map<string, Float32Array>(), 48_000);
	const controller = createController(store, undefined);
	try {
		const reference = await prepareStreamedAudioImport(new Blob([encoded], { type: 'audio/mpeg' }));
		const expected = new Float32Array(reference.descriptor.frameCount);
		let position = 0;
		await reference.stream({ chunkFrames: 65_536, onChunk(channels) { expected.set(channels[0]!, position); position += channels[0]!.length; } });
		await controller.ready;
		await controller.actions.project.importFiles([new File([...tags, encoded], 'Tagged recording.mp3', { type: 'audio/mpeg' })], { destination: 'timeline' });
		const project = controller.getSnapshot().project;
		assert.ok(validateAudioEditorProjectV17(project));
		assert.equal(project.sources.length, 1);
		const source = project.sources[0]!;
		assert.equal(source.frameCount, 48_001, 'metadata must not turn encoder delay and padding into source audio');
		assert.deepEqual(await storedChannel(store, source.id, 0), expected);
	} finally { await controller.dispose(); globalThis.fetch = originalFetch; }
});

test('a real streamed MP3 plus one leading ID3 tag retains the default stereo48000 programme through portable import', async context => {
	useLocalAudioCodecPayloads(context);
	const pcm = Float32Array.from({ length: 48_000 }, (_, frame) => .2 * Math.sin(2 * Math.PI * 440 * frame / 48_000));
	// The browser preserves its stereo master when exporting the centered mono
	// recording. These identical authored channels qualify that codec geometry;
	// they are encoder input, never a substitute for the native renderer.
	const staged = new Blob([Uint8Array.from(encodeWav([pcm, pcm.slice()], { sampleRate: 48_000, bitDepth: 32, float: true }))]);
	const interleaved = Float32Array.from({ length: 96_000 }, (_, sample) => pcm[Math.floor(sample / 2)]!);
	const project = createSoundscaperProject({ sampleRate: 48_000 });
	assert.equal(project.masterChannels, 2);
	const initial = createExportDialogInitialSettings(project);
	const settings = normalizeExportDialogAudioSettings({ ...initial, format: 'mp3' }, false, project.masterChannels);
	const request = createExportDialogRequest(settings, {
		project, desktop: false,
		channelMapping: settings.channelMapping,
		metadata: exportDialogMetadata('mp3', false, exportDialogMetadataFields(initial, {})),
	});
	assert.deepEqual([request.bitRateMode, request.bitRatePreset, request.bitRate, request.channelMapping], ['preset', 2, 192, 'preserve']);
	let frames = 0;
	const output = await encodeBrowserAudioFileStreamed(staged, 'mp3', { ...request, inputChannelCount: 2 }, createMediaExportCapabilities(), {
		// Adapt worker transport only: authenticated WASM, packet writes, final
		// geometry validation, metadata embedding and the default sink stay real.
		async openSession(codecRequest) {
			assert.deepEqual([codecRequest.format, codecRequest.frameCount, codecRequest.sampleRate, codecRequest.channelCount], ['mp3', 48_000, 48_000, 2]);
			assert.deepEqual(codecRequest.settings, { preset: 2 });
			const session = await openDedicatedAudioEncodeSession(codecRequest, {
				loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)),
			});
			return {
				async write(bytes: Uint8Array, count: number) {
					assert.ok(Buffer.from(bytes).equals(Buffer.from(interleaved.buffer, frames * 8, count * 8)), 'every actual encoder packet retains both interleaved authored channels');
					frames += count;
					return session.write(bytes, count);
				},
				async finish() { return session.finish(); },
				close() { session.close(); },
			};
		},
	});
	try {
		assert.equal(frames, 48_000);
		const encoded = new Uint8Array(await output.blob.arrayBuffer());
		assert.equal(new TextDecoder().decode(encoded.subarray(0, 3)), 'ID3');
		const mpegOffset = 10 + encoded.subarray(6, 10).reduce((size, byte) => size * 128 + byte, 0) + (encoded[5]! & 16 ? 10 : 0);
		assert.equal((encoded[mpegOffset + 1]! >> 3) & 3, 3, 'the browser default is MPEG1');
		assert.notEqual(encoded[mpegOffset + 3]! >> 6, 3, 'the actual encoded frame is stereo');
		assert.equal(new TextDecoder().decode(encoded.subarray(mpegOffset + 36, mpegOffset + 40)), 'Xing', 'default VBR uses the32-byte stereo side information');
		const extra = createAudioMetadataId3Tag({ artist: 'Session artist' });
		const options = { codecRuntime: createReviewedAudioCodecRuntime() };
		const controlFile = new File([encoded], 'Original.mp3', { type: 'audio/mpeg' });
		const taggedFile = new File([extra, encoded], 'Tagged recording.mp3', { type: 'audio/mpeg' });
		assert.equal(taggedFile.size, controlFile.size + extra.length);
		const control = await importAndReopenAudio(context, controlFile, options);
		const tagged = await importAndReopenAudio(context, taggedFile, options);
		for (const [result, file] of [[control, controlFile], [tagged, taggedFile]] as const) {
			assert.deepEqual([result.source.sampleRate, result.source.frameCount, result.source.channelCount], [48_000, 48_000, 2]);
			assert.equal(result.project.clips[0]?.durationFrames, 48_000);
			const origin = result.contribution.origin; assert.ok(origin?.kind === 'local-file');
			assert.equal(origin.originalFileName, file.name);
			assert.equal(origin.byteLength, file.size);
			assert.equal(result.channels.length, 2);
			for (const channel of result.channels) {
				assert.equal(channel.length, 48_000);
				let energy = 0, crossings = 0;
				for (let frame = 500; frame < 47_500; frame++) {
					energy += channel[frame]! ** 2;
					if (channel[frame - 1]! <= 0 && channel[frame]! > 0) crossings++;
				}
				const rms = Math.sqrt(energy / 47_000);
				assert.ok(rms > .12 && rms < .16, 'each independent authored channel has real440Hz tone energy');
				assert.ok(Math.abs(crossings - 47_000 * 440 / 48_000) <= 2, 'each decoded channel retains its authored frequency');
				assert.ok(channel.slice(47_600).some(sample => Math.abs(sample) > .1), 'the final400 authored frames retain tone in each channel');
			}
		}
		assertPcmChannelsEqual(tagged.channels, control.channels, 'a prepended metadata tag cannot change programme PCM');
	} finally { await output.cleanup(); }
});

test('Original MP3 derives its encoder strategy past every admitted leading ID3 tag', async () => {
	const encoded = await recording();
	const source = { kind: 'audio', sampleRate: 48_000, originalSampleRate: 48_000, channelCount: 1 };
	const original = await resolveDesktopOriginalExportSettings(new File([encoded], 'Plain.mp3'), [source]);
	assert.ok(original);
	const tags = Array.from({ length: 3 }, (_, index) => createAudioMetadataId3Tag({ title: `Title ${index}` }));
	assert.deepEqual(await resolveDesktopOriginalExportSettings(new File([...tags, encoded], 'Tagged.mp3'), [source]), original);
});


test('consecutive ID3 inspection seeks over large payloads with bounded cancellable reads', async () => {
	const first = Uint8Array.from(createAudioMetadataId3Tag({ title: 'Large tag' }));
	const length = 2 * 1024 * 1024;
	first.set([(length >>> 21) & 127, (length >>> 14) & 127, (length >>> 7) & 127, length & 127], 6);
	const second = createAudioMetadataId3Tag({ artist: 'Second tag' });
	const file = new Blob([first, new Uint8Array(10 + length - first.length), second, Uint8Array.of(255, 251, 144, 0)]);
	const reads: number[] = [];
	const source = { size: file.size, slice(start: number, end: number) { reads.push(end - start); return file.slice(start, end); } };
	assert.equal(await leadingId3AudioOffset(source), 10 + length + second.length);
	assert.ok(reads.every(size => size <= 10), 'tag payload bytes never enter the geometry probe');
	const abort = new AbortController();
	await assert.rejects(leadingId3AudioOffset({ size: file.size, slice(start: number, end: number) {
		abort.abort(); return file.slice(start, end);
	} }, undefined, abort.signal), { name: 'AbortError' });
	assert.equal(await leadingId3AudioOffset(new Blob([first])), null, 'truncated declared tag remains unprovable');
});
