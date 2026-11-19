/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { captureLightscaperNativePhotoResourceBodyCurrentV1 as capture, authenticateLightscaperNativePhotoResourceBodyCurrentV1 as authenticate,
	wipeLightscaperNativePhotoResourceBodyCurrentV1 as wipe } from '../desktop/lightscaper-native-photo-resource-body-current-v1.ts';
import { installLightscaperNativePhotoResourceBodyCurrentV1 as install, readLightscaperNativePhotoResourceBodyCurrentV1 as read } from '../desktop/lightscaper-native-photo-resource-records-current-v1.ts';
import { initializeLightscaperNativePhotoResourceDatabaseCurrentV1 as initialize } from '../desktop/lightscaper-native-photo-resources-database-current-v1.ts';
import { parseCubeLutV1 } from '../src/common/imaging/cube-lut-v1.ts';

function lut() {
	const text = 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1', parsed = parseCubeLutV1(text);
	return { bytes: new TextEncoder().encode(text), reference: { storageKey: `lut-sha256:${parsed.sha256}`, sha256: parsed.sha256,
		byteLength: parsed.byteLength, size: parsed.size, domainMin: parsed.domainMin, domainMax: parsed.domainMax } };
}
async function fixture(run: (database: DatabaseSync) => Promise<void>): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), 'lightscaper native resource records ')), database = new DatabaseSync(join(directory, 'resources.sqlite3'));
	try { initialize(database); await run(database); } finally { database.close(); }
	await rm(directory, { recursive: true, force: false });
}

test('Lightscaper native resource records refuse forged unauthenticated and mutated parser proofs before publication', async () => {
	await fixture(async database => {
		const input = lut(), packet = capture('lut', input.reference, input.bytes);
		try {
			assert.throws(() => install(database, packet)); await authenticate(packet);
			assert.throws(() => install(database, { ...packet })); packet.bytes[0] = 0; assert.throws(() => install(database, packet));
			assert.equal(database.prepare('SELECT count(*) AS total FROM native_photo_resources').get()?.total, 0); assert.equal(database.isTransaction, false);
		} finally { wipe(packet); }
	});
});

test('Lightscaper native resource records authenticate incoming bytes for immutable reuse and return private read snapshots', async () => {
	await fixture(async database => {
		const input = lut(), packet = capture('lut', input.reference, input.bytes);
		try {
			await authenticate(packet); assert.deepEqual(install(database, packet), { reference: input.reference, created: true });
			assert.deepEqual(install(database, packet), { reference: input.reference, created: false });
			const selected = read(database, 'lut', input.reference);
			try { await authenticate(selected); assert.deepEqual(selected.bytes, input.bytes); selected.bytes.fill(0); } finally { wipe(selected); }
			const fresh = read(database, 'lut', input.reference);
			try { await authenticate(fresh); assert.deepEqual(fresh.bytes, input.bytes); } finally { wipe(fresh); }
			assert.equal(database.isTransaction, false);
		} finally { wipe(packet); }
	});
});

test('Lightscaper native resource records refuse changed stored bytes without repairing or replacing the row', async () => {
	await fixture(async database => {
		const input = lut(), packet = capture('lut', input.reference, input.bytes);
		try {
			await authenticate(packet); install(database, packet); const corrupt = input.bytes.slice(); corrupt[0] = 0;
			database.prepare('UPDATE native_photo_resources SET body=? WHERE storage_key=?').run(corrupt, input.reference.storageKey);
			assert.throws(() => install(database, packet)); assert.equal(database.isTransaction, false);
			const selected = read(database, 'lut', input.reference);
			try { await assert.rejects(authenticate(selected)); assert.deepEqual(selected.bytes, corrupt); } finally { wipe(selected); }
			assert.deepEqual(database.prepare('SELECT body FROM native_photo_resources WHERE storage_key=?').get(input.reference.storageKey)?.body, corrupt);
		} finally { wipe(packet); }
	});
});
