/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { readApeMetadataTags } from '../src/common/editor/ape-metadata-reader.ts';
import { encodeBrowserAudioFileStreamed } from '../src/common/editor/browser-audio-streamed-encode.ts';
import type { BrowserDedicatedAudioFormat } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { openDedicatedAudioEncodeSession } from '../src/common/editor/dedicated-audio-encode-session.ts';
import { createId3Artwork, parseId3Artwork } from '../src/common/editor/id3-artwork.ts';
import { projectAudioMetadata, updateId3ProjectField } from '../src/common/editor/id3-descriptive-fields.ts';
import { createMediaExportCapabilities, normalizeMediaExportSettings } from '../src/common/editor/media-export.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { exportDialogMetadata, normalizeExportDialogAudioSettings } from '../src/common/editor/ui/export-dialog-audio-codec-options.ts';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { exportDialogMetadataFields } from '../src/common/editor/ui/export-dialog-metadata-fields.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { clipboardProject, createClipboardCustody } from './helpers/clipboard-source-custody.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=', 'base64');
const ARTWORK = { mimeType: 'image/png', pictureType: 3, description: 'cover.png', data: PNG.toString('base64') };
const EXPECTED = { title: '東京 — Episode', artist: 'Élodie', genre: 'Ambient', composer: 'Renée', id3Artwork: JSON.stringify([ARTWORK]) };
const FORMATS: readonly BrowserDedicatedAudioFormat[] = ['mp3', 'flac', 'ogg-vorbis', 'opus', 'wavpack', 'mp2'];

function record(value: unknown): Readonly<Record<string, unknown>> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	return Object.fromEntries(Object.entries(value));
}

test('authored ID3 history and Scape metadata feed real streamed codec profiles without changing source PCM', async context => {
	const custody = await createClipboardCustody(context);
	const { controller, store } = custody;
	const pcm = Float32Array.from({ length: 4608 }, (_, frame) => Math.sin(frame / 10) * .2);
	const source = createAudioSource({ id: 'id3-source', name: 'Programme.wav', sampleRate: 48_000, channelCount: 1, frameCount: pcm.length });
	const project = createSoundscaperProject({ id: 'id3-streamed', sampleRate: 48_000, sources: [source],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: pcm.length, sourceDurationFrames: pcm.length })] });
	await custody.open(project, new Map([[source.id, [pcm]]]));
	const update = (key: string, value: string): void => {
		controller.actions.metadata.update(updateId3ProjectField(clipboardProject(controller.project).metadata, key, value));
	};
	update('title', EXPECTED.title);
	update('artist', EXPECTED.artist);
	const beforeGenre = controller.getSnapshot().history.undoEntries.length;
	update('genre', EXPECTED.genre);
	assert.equal(controller.getSnapshot().history.undoEntries.length, beforeGenre + 1);
	controller.actions.edit.undo();
	assert.equal(projectAudioMetadata(clipboardProject(controller.project).metadata).genre, undefined);
	controller.actions.edit.redo();
	assert.equal(projectAudioMetadata(clipboardProject(controller.project).metadata).genre, 'Ambient');
	update('composer', EXPECTED.composer);
	const picture = await createId3Artwork(new File([PNG], 'cover.png', { type: 'image/png' }));
	assert.deepEqual(picture, ARTWORK);
	update('id3Artwork', JSON.stringify([picture]));
	const reopened = await custody.archive((_name, channels) => { assertPcmChannelsEqual(channels, [pcm]); });
	assert.deepEqual(projectAudioMetadata(reopened.metadata), EXPECTED);
	assert.deepEqual(parseId3Artwork(projectAudioMetadata(reopened.metadata).id3Artwork), [ARTWORK]);
	const restoredSource = reopened.sources[0];
	assert.ok(restoredSource?.kind === 'audio');
	assert.deepEqual([restoredSource.sampleRate, restoredSource.channelCount, restoredSource.frameCount], [48_000, 1, 4608]);
	const stagedChannels = await readCustodyPcm(store, restoredSource);
	assertPcmChannelsEqual(stagedChannels, [pcm]);
	// Authored stored PCM is an encoder input, never a substitute render result.
	const staged = new Blob([Uint8Array.from(encodeWav(stagedChannels, { sampleRate: 48_000, bitDepth: 32, float: true }))]);
	const before = clipboardProject(controller.project);
	const history = controller.getSnapshot().history.undoEntries.length;
	const capabilities = createMediaExportCapabilities();
	const initial = createExportDialogInitialSettings(reopened);
	assert.deepEqual([initial.metadataTitle, initial.metadataArtist, initial.metadataGenre], ['東京 — Episode', 'Élodie', 'Ambient']);
	for (const format of FORMATS) {
		const started = performance.now();
		const settings = normalizeExportDialogAudioSettings({ ...initial, format }, false, 1);
		const fields = exportDialogMetadataFields(initial, record(JSON.parse(initial.metadataCustom)));
		const request = createExportDialogRequest(settings, { metadata: exportDialogMetadata(format, false, fields) });
		assert.deepEqual(normalizeMediaExportSettings(format, { ...request, inputChannelCount: 1 }).metadata, EXPECTED, `${format} dialog metadata`);
		let frames = 0;
		const output = await encodeBrowserAudioFileStreamed(staged, format, { ...request, inputChannelCount: 1 }, capabilities, {
			// Only the browser worker transport changes: use the same authenticated
			// WASM session, packet owner, final validator, metadata writer and sink.
			async openSession(codecRequest) {
				assert.equal(codecRequest.format, format);
				assert.deepEqual([codecRequest.frameCount, codecRequest.sampleRate, codecRequest.channelCount], [4608, 48_000, 1]);
				const session = await openDedicatedAudioEncodeSession(codecRequest, {
					loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)),
				});
				return {
					async write(bytes: Uint8Array, count: number) {
						assert.deepEqual(bytes, new Uint8Array(pcm.buffer).subarray(frames * 4, (frames + count) * 4), `${format} actual PCM packet`);
						frames += count;
						return session.write(bytes, count);
					},
					async finish() { return session.finish(); },
					close() { session.close(); },
				};
			},
		});
		try {
			assert.equal(frames, 4608);
			assert.equal(output.extension, `.${format === 'ogg-vorbis' ? 'ogg' : format === 'wavpack' ? 'wv' : format}`);
			assert.ok(output.blob.size > 100);
			if (format === 'mp2' || format === 'wavpack') {
				const bytes = Buffer.from(await output.blob.arrayBuffer());
				assert.ok(bytes.includes(Buffer.from('Ambient')));
				assert.ok(bytes.includes(PNG));
			}
			const input = format === 'wavpack' ? null : new Input({ source: new BlobSource(output.blob), formats: ALL_FORMATS });
			try {
				const tags = input ? await input.getMetadataTags() : await readApeMetadataTags(output.blob);
				assert.deepEqual([tags.title, tags.artist, tags.genre], ['東京 — Episode', 'Élodie', 'Ambient'], `${format} independent tags`);
				const images: unknown = tags.images;
				assert.ok(Array.isArray(images), `${format} artwork collection`);
				assert.equal(images.length, 1, `${format} artwork count`);
				const image = record(images[0]);
				assert.ok(image.data instanceof Uint8Array, `${format} actual artwork bytes`);
				assert.deepEqual(Buffer.from(image.data), PNG, `${format} artwork bytes`);
				assert.equal(record(tags.raw)[format === 'mp3' || format === 'mp2' ? 'TCOM' : 'COMPOSER'], 'Renée', `${format} composer`);
			} finally { input?.dispose(); }
		} finally { await output.cleanup(); }
		assert.deepEqual(clipboardProject(controller.project), before, `${format} export leaves document unchanged`);
		assert.deepEqual(await store.loadProject(before.id), before, `${format} export leaves repository unchanged`);
		assert.equal(controller.getSnapshot().history.undoEntries.length, history);
		context.diagnostic(`${format} real streamed profile: ${(performance.now() - started).toFixed(1)}ms`);
	}
});
