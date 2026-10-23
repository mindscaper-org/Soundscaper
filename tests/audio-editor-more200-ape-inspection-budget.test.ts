/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMetadataBudgetWavPackFixture } from './helpers/wavpack-import-fixture.ts';
import { wavPackAudioBlob } from '../src/common/editor/ape-metadata-reader.ts';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';

for (const mode of ['control', 'fields', 'bytes'] as const) test(`WavPack audio survives optional APE ${mode} inspection limits`, async () => {
	const file = await createMetadataBudgetWavPackFixture(mode);
	const footer = new Uint8Array(await file.slice(-32).arrayBuffer()); const declared = new DataView(footer.buffer);
	assert.equal(new TextDecoder().decode(footer.subarray(0, 8)), 'APETAGEX');
	assert.equal(declared.getUint32(8, true), 2000);
	assert.equal(declared.getUint32(16, true), mode === 'bytes' ? 1 : mode === 'fields' ? 257 : 256);
	const inspection = await inspectImportedMediaMetadata(file);
	if (mode === 'control') assert.deepEqual(inspection.warnings, []);
	else assert.match(inspection.warnings.join('\n'), /APE.*(?:limit|trailer)/u);
	const reads: number[] = [];
	class BoundedFile extends Blob { override slice(start = 0, end = this.size, type = ''): Blob {
		const part = super.slice(start, end, type); const read = part.arrayBuffer.bind(part);
		part.arrayBuffer = () => {
			reads.push(end - start); assert.ok(end - start <= 32, 'audio-only stripping must never read optional metadata payload');
			return read();
		}; return part;
	} }
	const audio = await wavPackAudioBlob(new BoundedFile([file]));
	assert.equal(audio.size, file.size - declared.getUint32(12, true) - 32); assert.ok(reads.length > 0);
	const prepared = await prepareStreamedAudioImport(file);
	try { assert.equal(prepared.descriptor.sampleRate, 48_000); assert.equal(prepared.descriptor.frameCount, 4800); assert.equal(prepared.descriptor.channelCount, 2); }
	finally { prepared.dispose(); }
});

test('oversized APE metadata does not relax trailer bounds or optional-header matching', async () => {
	const file = await createMetadataBudgetWavPackFixture('fields'); const source = new Uint8Array(await file.arrayBuffer());
	for (const change of ['extent', 'header'] as const) {
		const bytes = source.slice(); const footer = new DataView(bytes.buffer, bytes.length - 32);
		if (change === 'extent') footer.setUint32(12, bytes.length + 1, true);
		else {
			const start = bytes.length - footer.getUint32(12, true) - 32;
			new DataView(bytes.buffer).setUint32(start + 16, 1, true);
		}
		await assert.rejects(wavPackAudioBlob(new Blob([bytes])), /APEv2/u);
	}
});
