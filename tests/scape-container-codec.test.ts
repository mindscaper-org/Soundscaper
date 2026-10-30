/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readScapeArchiveEnvelope, type ScapeArchiveEntry, type ScapeFamilyCodec } from '../src/common/scape/archive-envelope.ts';

const identity = { schemaFamily: 'test-product', schemaVersion: 7 } as const;
const codec: ScapeFamilyCodec<'test-product'> = {
	readIdentity(value) {
		assert.equal((value as Record<string, unknown>).schemaFamily, identity.schemaFamily);
		assert.equal((value as Record<string, unknown>).schemaVersion, identity.schemaVersion);
		return identity;
	},
	parseProjectDocument(text) { return JSON.parse(text) as unknown; },
};

function entry(filename: string, value: unknown): ScapeArchiveEntry {
	const bytes = new TextEncoder().encode(JSON.stringify(value));
	return {
		filename, directory: false, encrypted: false, compressionMethod: 0,
		compressedSize: bytes.byteLength, uncompressedSize: bytes.byteLength,
		async getData(writable, options) {
			if (options?.checkOverlappingEntryOnly) return;
			const writer = writable.getWriter();
			await writer.write(bytes);
			await writer.close();
		},
	};
}

function archive(assetKind?: string): ScapeArchiveEntry[] {
	const project = entry('project.json', identity);
	const asset = entry('asset.bin', {});
	return [entry('manifest.json', {
		format: 'scape-project', formatVersion: 1,
		project: { ...identity, entry: project.filename, size: project.uncompressedSize, sha256: '0'.repeat(64) },
		assets: assetKind === undefined ? [] : [{ sourceId: 'future', kind: assetKind, encoding: 'opaque',
			entry: asset.filename, size: asset.uncompressedSize, sha256: '0'.repeat(64) }],
	}), project, ...(assetKind === undefined ? [] : [asset])];
}

void test('Scape codecs may preserve bounded unknown asset kinds for a classified document identity', async () => {
	const entries = archive('future-asset');
	await assert.rejects(readScapeArchiveEnvelope(entries, codec), /invalid kind/u);
	await assert.rejects(readScapeArchiveEnvelope(entries, { ...codec, preserveUnknownAssetKinds: () => false }), /invalid kind/u);
	const preserving: ScapeFamilyCodec<'test-product'> = { ...codec, preserveUnknownAssetKinds: value => {
		assert.deepEqual(value, identity);
		return true;
	} };
	assert.equal((await readScapeArchiveEnvelope(entries, preserving)).manifest.assets[0]!.kind, 'future-asset');
	for (const invalid of ['../asset', 'x'.repeat(65)]) {
		await assert.rejects(readScapeArchiveEnvelope(archive(invalid), preserving), /invalid kind/u);
	}
});

void test('Scape envelope delegates family identity and document parsing to its supplied codec', async () => {
	const envelope = await readScapeArchiveEnvelope(archive(), codec);
	assert.equal(envelope.manifest.project.schemaFamily, 'test-product');
	assert.equal(envelope.manifest.project.schemaVersion, 7);
	assert.equal(envelope.projectText, JSON.stringify(identity));
});

void test('Scape envelope checks the product identity before exposing an archive', async () => {
	const wrong: ScapeFamilyCodec<'test-product'> = { ...codec, parseProjectDocument: () => ({}) };
	await assert.rejects(readScapeArchiveEnvelope(archive(), wrong));
});

void test('Scape envelope keeps entry bounds and ownership independent of its family codec', async () => {
	await assert.rejects(readScapeArchiveEnvelope(archive(), codec, { maximumEntryCount: 1 }), /too many entries/u);
	await assert.rejects(readScapeArchiveEnvelope([...archive(), entry('orphan.bin', {})], codec), /Unreferenced entry/u);
	await assert.rejects(readScapeArchiveEnvelope([...archive(), entry('../bad', {})], codec), /Unsafe Scape entry/u);
});
