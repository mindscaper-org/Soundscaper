/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../src/common/editor/wav-import.js';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { normalizeSourceProvenance } from '../src/common/editor/source-provenance.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { createController, createTwoTrackFixture, storedChannel } from './helpers/audio-editor-multitrack-selection-harness.js';
import { pipedWavFixture } from './helpers/piped-wav-fixture.ts';

test('File Import retains bounded pipe WAV PCM, recorder BEXT, and INFO attribution', async () => {
	const { store } = await createTwoTrackFixture('next-piped-wav', new Map<string, Float32Array>(), 48_000);
	const controller = createController(store, undefined);
	try {
		await controller.ready;
		await controller.actions.project.importFiles([new File([pipedWavFixture()], 'piped.wav', { type: 'audio/wav' })], { destination: 'timeline' });
		const snapshot = controller.getSnapshot();
		assert.ok(snapshot.project);
		assert.ok(validateAudioEditorProjectV17(snapshot.project));
		const project = snapshot.project;
		assert.equal(project.sources.length, 1, 'PCM must publish through the incremental import route');
		const source = project.sources[0]!;
		assert.deepEqual(await storedChannel(store, source.id, 0), Float32Array.of(.25, -.25, .5, -.5));
		assert.equal(project.metadata.bext?.description, 'Pipe microphone take');
		assert.equal(project.metadata.bext?.originator, 'Field recorder');
		const imported = normalizeSourceProvenance(source.provenance, 'pipe WAV').contributions[0]!;
		assert.equal(imported.metadata.normalized.title, 'Piped title');
		assert.equal(imported.metadata.normalized.artist, 'Alice');
		assert.deepEqual(imported.warnings, []);
	} finally { await controller.dispose(); }
});

test('pipe WAV metadata inspection never reads its terminal PCM payload', async () => {
	const bytes = pipedWavFixture(new Float32Array(65_536));
	const dataOffset = bytes.length - 65_536 * 2;
	class MetadataFile extends File {
		override slice(start = 0, end = this.size, type?: string): Blob {
			assert.ok(end <= dataOffset || start >= this.size, 'metadata inspection must skip PCM');
			return super.slice(start, end, type);
		}
	}
	const inspected = await inspectImportedMediaMetadata(new MetadataFile([bytes], 'piped.wav'));
	assert.equal(inspected.metadata.normalized?.title, 'Piped title');
	assert.equal(inspected.metadata.normalized?.artist, 'Alice');
	assert.deepEqual(inspected.warnings, []);
});

test('an odd terminal eight-bit pipe payload needs no unavailable writer pad byte', async () => {
	const header = pipedWavFixture().slice(0, 36);
	const view = new DataView(header.buffer);
	view.setUint16(32, 1, true); view.setUint16(34, 8, true); view.setUint32(28, 48_000, true);
	const file = new Blob([header, Uint8Array.of(100, 97, 116, 97, 255, 255, 255, 255, 128, 160, 96)]);
	const descriptor = await inspectWavBlobPcm(file);
	assert.equal(descriptor.frameCount, 3);
	const pcm: number[] = [];
	await streamWavBlobPcm(file, { descriptor, chunkFrames: 2, onChunk(channels: readonly Float32Array[]) { pcm.push(...channels[0]!); } });
	assert.deepEqual(pcm, [0, .25, -.25]);
});

test('ordinary truncation and unpaired unknown RIFF lengths remain refused', async () => {
	const bytes = pipedWavFixture();
	const dataLength = bytes.length - 8;
	new DataView(bytes.buffer).setUint32(4, dataLength + 2, true);
	await assert.rejects(inspectWavBlobPcm(new Blob([bytes])), /truncated/u);
	new DataView(bytes.buffer).setUint32(4, 0xffff_ffff, true);
	new DataView(bytes.buffer).setUint32(bytes.length - 12, 8, true);
	await assert.rejects(inspectWavBlobPcm(new Blob([bytes])), /truncated|unknown|stream|size/u);
});
