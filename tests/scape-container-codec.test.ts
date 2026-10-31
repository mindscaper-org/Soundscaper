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

function archive(): ScapeArchiveEntry[] {
	const project = entry('project.json', identity);
	return [entry('manifest.json', {
		format: 'scape-project', formatVersion: 1,
		project: { ...identity, entry: project.filename, size: project.uncompressedSize, sha256: '0'.repeat(64) },
		assets: [],
	}), project];
}

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

void test('Scape envelope delegates family-specific asset admission to the product codec', async () => {
	const project = entry('project.json', identity), asset = entry('assets/product.bin', {});
	const entries = [entry('manifest.json', {
		format: 'scape-project', formatVersion: 1,
		project: { ...identity, entry: project.filename, size: project.uncompressedSize, sha256: '0'.repeat(64) },
		assets: [{ sourceId: 'product-source', entry: asset.filename, size: asset.uncompressedSize,
			sha256: '0'.repeat(64), kind: 'product-only', encoding: 'test-v1' }],
	}), project, asset];
	let admitted = false;
	const familyCodec: ScapeFamilyCodec<'test-product'> = { ...codec,
		resolveAssetKinds(receivedIdentity, additional) {
			assert.deepEqual(receivedIdentity, identity);
			assert.deepEqual(additional, ['registered-kind']);
			admitted = true;
			return new Set(['product-only']);
		},
	};
	assert.equal((await readScapeArchiveEnvelope(entries, familyCodec, {}, undefined, ['registered-kind'])).manifest.assets[0]?.kind, 'product-only');
	assert.equal(admitted, true);
	await assert.rejects(readScapeArchiveEnvelope(entries, codec), /invalid kind/u);
});
