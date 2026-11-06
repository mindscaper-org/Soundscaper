/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { inspectAiffBlobPcm } from '../src/common/editor/aiff-pcm-chunk-reader.ts';
import { prepareImportedSourceProvenance } from '../src/common/editor/controller/import/internal/imported-source-provenance.ts';
import { createAudioEditorProjectV17, validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createFreesoundUploadMetadataDefaults } from '../src/common/editor/freesound-upload-metadata.ts';
import { encodeAiff } from '../src/common/editor/aiff.js';

test('an unchanged SoX AIFF file comment survives native source metadata and the prepared upload description', async () => {
	// SoX14.4.2: -R -n -r48000 -c1 -b16 --comment 'Harbour take 7'
	// output.aiff synth0.1 sine440 vol0.1. Its native soxi -a reader returns this comment.
	const encoded = await readFile(new URL('./fixtures/sox-comt-comment.aiff.base64', import.meta.url), 'utf8');
	const file = new File([Buffer.from(encoded.trim(), 'base64')], 'Harbour.aiff', { type: 'audio/aiff' });
	assert.equal((await inspectAiffBlobPcm(file)).frameCount, 4800);
	const provenance = await prepareImportedSourceProvenance(file, { createContributionId: () => 'harbour-comment' });
	assert.equal(provenance.contributions[0]?.metadata.normalized?.comment, 'Harbour take 7');
	const project = createAudioEditorProjectV17({ sampleRate: 48_000,
		sources: [{ id: 'source', name: file.name, sampleRate: 48_000, channelCount: 1, frameCount: 4800,
			sampleFormat: 'float32', storageKey: 'source', provenance }],
		clips: [{ id: 'clip', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 4800, durationFrames: 4800 }],
		tracks: [{ id: 'track', type: 'audio', name: 'Harbour', clipIds: ['clip'] }] });
	const reopened: unknown = JSON.parse(JSON.stringify(project));
	assert.ok(validateAudioEditorProjectV17(reopened));
	const defaults = createFreesoundUploadMetadataDefaults({ fileName: file.name, source: reopened.sources[0], clip: reopened.clips[0] });
	assert.match(defaults.description, /Comment: Harbour take 7/u);
	assert.deepEqual(reopened.sources[0]?.provenance, provenance);
});

test('unbound COMT records retain source order and verbatim whitespace without promoting marker comments', async () => {
	const records = [{ markerId: 3, text: 'Marker-specific detail' }, { markerId: 0, text: '\n  Scene one\n' },
		{ markerId: 0, text: '    Door closes\n' }];
	const inspected = await inspectImportedMediaMetadata(withChunks([commentChunk(records)]));
	assert.equal(inspected.metadata.normalized?.comment, '\n  Scene one\n\n    Door closes\n');
	const aiff = inspected.metadata.namespaces?.aiff;
	assert.ok(aiff && typeof aiff === 'object' && !Array.isArray(aiff) && 'comments' in aiff);
	const comments = aiff.comments;
	assert.ok(Array.isArray(comments));
	assert.deepEqual(comments.map(comment => {
		assert.ok(comment && typeof comment === 'object' && !Array.isArray(comment));
		return { markerId: comment.markerId, text: comment.text, timestamp: comment.timestamp };
	}), records.map(record => ({ ...record, timestamp: '1970-01-01T00:00:00.000Z' })));
});

for (const records of [[{ markerId: 2, text: 'Marker-specific detail' }], [{ markerId: 0, text: ' \t\n' }]]) {
	test(`COMT ${records[0]!.markerId === 0 ? 'blank text' : 'marker-specific text'} cannot hide independent ID3 comments`, async () => {
		const inspected = await inspectImportedMediaMetadata(withChunks([commentChunk(records)], { comments: 'Independent credit' }));
		assert.equal(inspected.metadata.normalized?.comment, 'Independent credit');
	});
}

test('ordinary ANNO priority stays intact when COMT also supplies a file comment', async () => {
	const inspected = await inspectImportedMediaMetadata(withChunks([
		chunk('ANNO', new TextEncoder().encode('Original annotation')),
		commentChunk([{ markerId: 0, text: 'File comment' }]),
	], { comments: 'Independent credit' }));
	assert.equal(inspected.metadata.normalized?.comment, 'Original annotation');
	assert.equal(inspected.metadata.raw?.ANNO, 'Original annotation');
});

function commentChunk(records: readonly Readonly<{ markerId: number; text: string }>[]): Uint8Array<ArrayBuffer> {
	const texts = records.map(record => new TextEncoder().encode(record.text));
	const payload = new Uint8Array(2 + texts.reduce((sum, text) => sum + 8 + text.length + text.length % 2, 0));
	const view = new DataView(payload.buffer);
	view.setUint16(0, records.length);
	let offset = 2;
	for (const [index, record] of records.entries()) {
		const text = texts[index]!;
		view.setUint32(offset, 2_082_844_800); view.setUint16(offset + 4, record.markerId); view.setUint16(offset + 6, text.length);
		payload.set(text, offset + 8); offset += 8 + text.length + text.length % 2;
	}
	return chunk('COMT', payload);
}

function chunk(id: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(8 + payload.length + payload.length % 2);
	bytes.set(new TextEncoder().encode(id)); new DataView(bytes.buffer).setUint32(4, payload.length); bytes.set(payload, 8);
	return bytes;
}

function withChunks(chunks: readonly Uint8Array[], metadata = {}): File {
	const original = encodeAiff([new Float32Array(4)], { sampleRate: 48_000, bitDepth: 16, metadata });
	assert.ok(original instanceof Uint8Array);
	const bytes = new Uint8Array(original.length + chunks.reduce((sum, value) => sum + value.length, 0));
	bytes.set(original);
	let offset = original.length;
	for (const value of chunks) { bytes.set(value, offset); offset += value.length; }
	new DataView(bytes.buffer).setUint32(4, bytes.length - 8);
	return new File([bytes], 'Comment.aiff', { type: 'audio/aiff' });
}
