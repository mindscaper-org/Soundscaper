/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createScapeArchiveByteSource, type ScapeArchiveByteReadRequest } from '../src/common/scape/archive-byte-source.ts';
import { readScapeArchiveEnvelope, type ScapeArchiveEntry, type ScapeFamilyCodec } from '../src/common/scape/archive-envelope.ts';
import { maximumScapeStoreCentralDirectoryBytes } from '../src/common/scape/archive-zip-profile.ts';
import { ScapeExpandedByteBudget } from '../src/common/scape/expanded-byte-budget.ts';

const identity = { schemaFamily: 'contract-fixture', schemaVersion: 1 };
const codec: ScapeFamilyCodec<string> = { readIdentity: () => identity, parseProjectDocument: text => JSON.parse(text) as unknown };
const projectText = JSON.stringify(identity);
const descriptor = { entry: 'project.json', size: new TextEncoder().encode(projectText).length, sha256: '0'.repeat(64), ...identity };
const manifest = () => ({ format: 'scape-project', formatVersion: 1, project: { ...descriptor }, assets: [] as unknown[] });

function entry(filename: string, text: string, chunk?: unknown): ScapeArchiveEntry {
	const bytes = new TextEncoder().encode(text);
	return { filename, directory: false, encrypted: false, compressionMethod: 0, compressedSize: bytes.length, uncompressedSize: bytes.length,
		async getData(writable, options) {
			if (options?.checkOverlappingEntryOnly) return;
			const writer = writable.getWriter();
			await writer.write((chunk ?? bytes) as Uint8Array);
			await writer.close();
		} };
}
const archive = (value: unknown) => [entry('manifest.json', JSON.stringify(value)), entry('project.json', projectText)];

test('archive byte sources require an actual provider and structured read requests', async () => {
	assert.throws(() => createScapeArchiveByteSource({ size: 1 } as Parameters<typeof createScapeArchiveByteSource>[0]), /provider/u);
	const source = createScapeArchiveByteSource({ size: 1, read: () => new Uint8Array(1) });
	await assert.rejects(source.read(null as unknown as ScapeArchiveByteReadRequest), /request is required/u);
});

test('ZIP planning and cumulative accounting reject malformed names and byte counts', () => {
	for (const filename of ['', 'a'.repeat(65_536)]) {
		assert.throws(() => maximumScapeStoreCentralDirectoryBytes([{ filename }]), /filename/u);
	}
	assert.throws(() => maximumScapeStoreCentralDirectoryBytes(Array.from({ length: 4097 }, () => ({ filename: 'a' }))), /too many/u);
	assert.throws(() => new ScapeExpandedByteBudget(0), /positive safe integer/u);
	assert.throws(() => new ScapeExpandedByteBudget(1).consume(-1, 'asset'), /invalid byte count/u);
});

test('Scape manifests validate family-neutral metadata before exposing any asset', async () => {
	const asset = { entry: 'asset.bin', size: 1, sha256: '0'.repeat(64), sourceId: 'source', kind: 'audio', encoding: 'pcm' };
	for (const [value, error] of [
		[{ ...manifest(), formatVersion: 99 }, /Unsupported Scape format/u],
		[{ ...manifest(), project: null }, /incomplete/u],
		[{ ...manifest(), project: { ...descriptor, size: -1 } }, /invalid size/u],
		[{ ...manifest(), project: { ...descriptor, sha256: null } }, /SHA-256/u],
		[{ ...manifest(), assets: [null] }, /descriptor is invalid/u],
		[{ ...manifest(), assets: [{ ...asset, sourceId: '' }] }, /source ID/u],
		[{ ...manifest(), assets: [{ ...asset, kind: 'unknown' }] }, /invalid kind/u],
		[{ ...manifest(), assets: [{ ...asset, encoding: '' }] }, /encoding/u],
		[{ ...manifest(), assets: [{ ...asset, entry: 'project.json', size: descriptor.size }] }, /reserved/u],
		[{ ...manifest(), assets: [asset] }, /missing asset.bin/u],
	] as const) {
		await assert.rejects(readScapeArchiveEnvelope(archive(value), { ...codec, assetKinds: ['audio'] }), error);
	}
	await assert.rejects(readScapeArchiveEnvelope([...archive({ ...manifest(), assets: [asset, { ...asset, sourceId: 'second' }] }), entry('asset.bin', 'a')],
		{ ...codec, assetKinds: ['audio'] }), /more than one descriptor/u);
	await assert.rejects(readScapeArchiveEnvelope([entry('manifest.json', '{'), entry('project.json', projectText)], codec), /not valid JSON/u);
	await assert.rejects(readScapeArchiveEnvelope(archive(manifest()), codec, { unknown: 1 } as Parameters<typeof readScapeArchiveEnvelope>[2]), /Unsupported Scape archive limit/u);
});

test('custom asset-kind registries are bounded, valid, and cannot duplicate family kinds', async () => {
	for (const kinds of [Array.from({ length: 65 }, () => 'audio'), ['INVALID'], ['audio', 'audio']]) {
		await assert.rejects(readScapeArchiveEnvelope(archive(manifest()), codec, {}, undefined, kinds), /asset kind/iu);
	}
	await assert.rejects(readScapeArchiveEnvelope(archive(manifest()), { ...codec, assetKinds: ['INVALID'] }), /Family Scape asset kinds/u);
});

test('text-entry reads authenticate actual emitted bytes and reject foreign chunks', async () => {
	const text = JSON.stringify(manifest());
	const changed = archive(manifest());
	changed[0] = { ...changed[0]!, uncompressedSize: changed[0]!.uncompressedSize + 1, compressedSize: changed[0]!.compressedSize + 1 };
	await assert.rejects(readScapeArchiveEnvelope(changed, codec), /do not match its archive metadata/u);
	await assert.rejects(readScapeArchiveEnvelope([entry('manifest.json', text, 'foreign chunk'), entry('project.json', projectText)], codec), /non-byte chunk/u);
	const bytes = new TextEncoder().encode(text);
	assert.equal((await readScapeArchiveEnvelope([entry('manifest.json', text, bytes.buffer), entry('project.json', projectText)], codec)).projectText, projectText);
});
