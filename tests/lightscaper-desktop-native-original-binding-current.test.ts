/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { LightscaperNativeOriginalStoreCurrentV1 as Originals, consumeLightscaperNativeOriginalPublicationCurrentV1 as consume } from '../desktop/lightscaper-native-original-store-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 as paths, lightscaperNativePhotoOriginalBodyPathCurrentV1 as bodyPath } from '../desktop/lightscaper-native-original-index-current-v1.ts';

const bytes = new TextEncoder().encode('genuine immutable encoded Original bytes');
const binding = Object.freeze({ storageKey: 'physical-original', byteLength: bytes.byteLength,
	contentSha256: createHash('sha256').update(bytes).digest('hex') });
async function* chunks() { yield bytes; }
async function fixture(context: TestContext) {
	const appDataPath = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper native physical binding ')));
	const owner = await Originals.open({ appDataPath });
	context.after(async () => { await owner.close(); await rm(appDataPath, { recursive: true, force: true }); });
	return { owner, appDataPath, databasePath: paths(appDataPath).databasePath };
}

test('Lightscaper native physical binding stores authentic bytes without manufacturing Photo dimensions or alias metadata', async context => {
	const f = await fixture(context), proof = await f.owner.storeBinding(binding, chunks());
	assert.equal(Object.isFrozen(proof), true); assert.deepEqual(Reflect.ownKeys(proof), []);
	await f.owner.verifyBinding(binding);
	assert.deepEqual(await f.owner.readBinding(binding, 3, 11), bytes.slice(3, 14));
	const database = new DatabaseSync(f.databasePath);
	try {
		database.exec('BEGIN IMMEDIATE'); assert.deepEqual(consume(proof, database), binding); database.exec('COMMIT');
		database.exec('BEGIN IMMEDIATE'); assert.throws(() => consume(proof, database), /publication|proof/iu); database.exec('ROLLBACK');
		assert.equal(database.prepare('SELECT count(*) AS n FROM native_photo_media_assets').get()?.n, 0);
	} finally { database.close(); }
});

test('Lightscaper native physical publication proof requires an owned transaction and the exact actual namespace', async context => {
	const first = await fixture(context), second = await fixture(context);
	const proof = await first.owner.storeBinding(binding, chunks());
	const wrong = new DatabaseSync(second.databasePath), right = new DatabaseSync(first.databasePath);
	try {
		assert.throws(() => consume(proof, right), /transaction/iu);
		wrong.exec('BEGIN IMMEDIATE'); assert.throws(() => consume(proof, wrong), /namespace|publication|proof/iu); wrong.exec('ROLLBACK');
		right.exec('BEGIN IMMEDIATE'); assert.deepEqual(consume(proof, right), binding); right.exec('COMMIT');
	} finally { wrong.close(); right.close(); }
});

test('Lightscaper native physical publication refuses structurally forged and Proxy-wrapped proofs without reflecting them', async context => {
	const f = await fixture(context), proof = await f.owner.storeBinding(binding, chunks());
	let reflected = 0;
	const proxy = new Proxy(proof, { get() { reflected++; throw new Error('Proof inspected'); }, ownKeys() { reflected++; throw new Error('Proof keys inspected'); } });
	const database = new DatabaseSync(f.databasePath);
	try {
		database.exec('BEGIN IMMEDIATE');
		assert.throws(() => consume(Object.freeze({ ...binding }), database), /publication|proof/iu);
		assert.throws(() => consume(proxy, database), /publication|proof/iu); assert.equal(reflected, 0);
		assert.deepEqual(consume(proof, database), binding); database.exec('COMMIT');
	} finally { database.close(); }
});

test('Lightscaper native physical publication cannot escape its retired producer owner', async context => {
	const f = await fixture(context), proof = await f.owner.storeBinding(binding, chunks());
	await f.owner.close();
	const database = new DatabaseSync(f.databasePath);
	try {
		database.exec('BEGIN IMMEDIATE'); assert.throws(() => consume(proof, database), /retired|publication|proof/iu); database.exec('ROLLBACK');
	} finally { database.close(); }
	await assert.rejects(f.owner.verifyBinding(binding), /clos/iu);
});

test('Lightscaper native physical binding still rejects different bytes, missing authority and tampered actual files', async context => {
	const f = await fixture(context);
	await assert.rejects(f.owner.verifyBinding(binding), /binding/iu);
	await assert.rejects(f.owner.storeBinding(binding, (async function* () { yield Uint8Array.of(1); })()), /length|SHA/iu);
	await f.owner.storeBinding(binding, chunks());
	await assert.rejects(f.owner.verifyBinding({ ...binding, byteLength: binding.byteLength + 1 }), /different|binding/iu);
	await writeFile(bodyPath(paths(f.appDataPath), binding.contentSha256), new Uint8Array(bytes.byteLength));
	await assert.rejects(f.owner.verifyBinding(binding), /SHA|digest/iu);
});

test('Lightscaper physical binding captures inert fields before queued work and refuses descriptor accessors', async context => {
	const f = await fixture(context); let reads = 0;
	await assert.rejects(f.owner.storeBinding({ ...binding, get byteLength() { reads++; return bytes.byteLength; } }, chunks()), /data property/iu);
	assert.equal(reads, 0);
	const queued = { ...binding, storageKey: String(binding.storageKey) }; const stored = f.owner.storeBinding(queued, chunks()); queued.storageKey = 'retargeted'; queued.byteLength = 1;
	await stored; await f.owner.verifyBinding(binding);
	await assert.rejects(f.owner.verifyBinding(queued));
});
