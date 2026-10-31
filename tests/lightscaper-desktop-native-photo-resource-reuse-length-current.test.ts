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

test('Lightscaper native immutable LUT reuse rejects an authentic prefix with appended stored bytes and never repairs the body', async () => {
	const text = 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1', parsed = parseCubeLutV1(text);
	const bytes = new TextEncoder().encode(text), reference = { storageKey: `lut-sha256:${parsed.sha256}`, sha256: parsed.sha256,
		byteLength: parsed.byteLength, size: parsed.size, domainMin: parsed.domainMin, domainMax: parsed.domainMax };
	const directory = await mkdtemp(join(tmpdir(), 'lightscaper resource extra bytes ')), database = new DatabaseSync(join(directory, 'resources.sqlite3'));
	const packet = capture('lut', reference, bytes);
	try {
		initialize(database); await authenticate(packet); assert.equal(install(database, packet).created, true);
		// Corrupt only a genuinely installed row. Its authentic prefix remains
		// exactly equal to the incoming proof, but its physical body is longer.
		const appended = new Uint8Array(bytes.byteLength + 1); appended.set(bytes); appended[bytes.byteLength] = 10;
		database.prepare('UPDATE native_photo_resources SET body=? WHERE storage_key=?').run(appended, reference.storageKey);
		const selected = read(database, 'lut', reference);
		try { await assert.rejects(authenticate(selected)); } finally { wipe(selected); }
		assert.throws(() => install(database, packet), /body|byte|length|immutable/iu);
		assert.equal(database.isTransaction, false);
		assert.deepEqual(database.prepare('SELECT body FROM native_photo_resources WHERE storage_key=?').get(reference.storageKey)?.body, appended);
		assert.equal(database.prepare('SELECT COUNT(*) AS count FROM native_photo_resources').get()?.count, 1);
	} finally { wipe(packet); database.close(); }
	await rm(directory, { recursive: true, force: false });
});
