/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { inspectAiffBlobPcm } from '../src/common/editor/aiff-pcm-chunk-reader.ts';
import { prepareSessionMediaProvenance } from '../src/common/editor/controller/import/internal/imported-source-provenance.ts';
import { createAudioEditorProjectV17, validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { encodeAiff } from '../src/common/editor/aiff.js';

const COMMENT = '\n  Scene one\n    Door closes\n';

test('unchanged libsndfile AIFF comment formatting remains verbatim in raw metadata and native Save', async () => {
	// libsndfile sf_set_string(SF_STR_COMMENT, COMMENT), AIFF/PCM16, 48 kHz,
	// mono, four zero frames. The native producer/reader preserves every byte.
	const encoded = await readFile(new URL('./fixtures/libsndfile-comment-whitespace.aiff.base64', import.meta.url), 'utf8');
	const file = new File([Buffer.from(encoded.trim(), 'base64')], 'Scene.aiff', { type: 'audio/aiff' });
	assert.equal((await inspectAiffBlobPcm(file)).frameCount, 4);
	const provenance = await prepareSessionMediaProvenance(file, { originalFileName: file.name,
		mimeType: file.type, createContributionId: () => 'recorded-comment' });
	assert.equal(provenance.contributions[0]?.metadata.raw.ANNO, COMMENT);
	assert.equal(provenance.contributions[0]?.metadata.normalized.comment, COMMENT);
	const project = createAudioEditorProjectV17({ sampleRate: 48_000, sources: [{ id: 'source', kind: 'audio', name: file.name,
		sampleRate: 48_000, channelCount: 1, frameCount: 4, sampleFormat: 'float32', storageKey: 'source', provenance }],
		clips: [{ id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4 }],
		tracks: [{ id: 'track', type: 'audio', name: 'Scene', clipIds: ['clip'] }] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		const source = project.sources[0]!;
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(4)]); await writer.commit();
		await store.saveProject(project);
		const reopened: unknown = await store.loadProject(project.id);
		assert.ok(validateAudioEditorProjectV17(reopened));
		assert.deepEqual(reopened.sources[0]?.provenance, provenance);
	} finally { await store.close(); }
});

test('AIFF COMT comment records preserve indentation and surrounding newlines', async () => {
	const text = new TextEncoder().encode(COMMENT);
	const payload = new Uint8Array(10 + text.length + text.length % 2);
	const view = new DataView(payload.buffer);
	view.setUint16(0, 1); view.setUint16(8, text.length); payload.set(text, 10);
	const inspected = await inspectImportedMediaMetadata(withChunk('COMT', payload));
	const aiff = inspected.metadata.namespaces?.aiff;
	assert.ok(aiff && typeof aiff === 'object' && !Array.isArray(aiff) && 'comments' in aiff);
	const comments = aiff.comments;
	assert.ok(Array.isArray(comments));
	const first = comments[0];
	assert.ok(first && typeof first === 'object' && !Array.isArray(first));
	assert.equal(first.text, COMMENT);
});

test('blank native AIFF annotations still allow independent ID3 comment fallback', async () => {
	const inspected = await inspectImportedMediaMetadata(withChunk('ANNO', new TextEncoder().encode(' \t '), { comments: 'Independent credit' }));
	assert.equal(inspected.metadata.normalized?.comment, 'Independent credit');
	assert.equal(inspected.metadata.raw?.ANNO, ' \t ');
});

function withChunk(id: string, payload: Uint8Array, metadata = {}): File {
	const original = encodeAiff([new Float32Array(4)], { sampleRate: 48_000, bitDepth: 16, metadata });
	assert.ok(original instanceof Uint8Array);
	const bytes = new Uint8Array(original.length + 8 + payload.length + payload.length % 2);
	bytes.set(original); bytes.set(new TextEncoder().encode(id), original.length);
	new DataView(bytes.buffer).setUint32(original.length + 4, payload.length);
	bytes.set(payload, original.length + 8);
	new DataView(bytes.buffer).setUint32(4, bytes.length - 8);
	return new File([bytes], 'Comment.aiff', { type: 'audio/aiff' });
}
