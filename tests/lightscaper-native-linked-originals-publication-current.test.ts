/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 as paths } from '../desktop/lightscaper-native-original-index-current-v1.ts';
import test from 'node:test';
import { linkedOriginalsFixtureCurrentV1 as fixture, linkedCountsCurrentV1 as counts,
	options, CATALOG, IMPORT, hash, withInput, Linked, path, ticket, linkedBytesCurrentV1 as bytes } from './helpers/lightscaper-native-linked-originals-integration-fixture-current.ts';

void test('Lightscaper actual linked input hashes genuine native bytes before SQL and publication keeps no managed binding or body copy', options, async context => {
	await fixture(context, async f => {
		const entry = await f.prepare(), peer = f.peer();
		try {
			assert.deepEqual(counts(peer), [0,0,0,0,0]);
			assert.equal(entry.input.facts.contentSha256, hash(entry.bytes)); assert.equal(entry.input.facts.byteLength, entry.bytes.byteLength);
			assert.equal(entry.input.facts.modifiedTime, null); assert.equal(Object.isFrozen(entry.input.facts), true);
			assert.equal(await withInput(entry.input, f.mediaDatabasePath, async view => hash(await view.read(0, view.byteLength))), hash(entry.bytes));
			const receipt = await f.publish(entry, false);
			assert.equal(receipt.sourceId, entry.photo.original.storageKey); assert.equal(receipt.sha256, hash(entry.bytes)); assert.equal(receipt.size, entry.bytes.byteLength);
			assert.equal(receipt.storage, 'native-photo-linked-original'); assert.equal(receipt.privateNote, 'detached descriptive field');
			for (const key of ['path','grantId','locatorId','nativePath','root_count','media_content_token']) assert.equal(Object.hasOwn(receipt,key), false);
			assert.deepEqual(counts(peer), [1,1,1,1,0]);
			assert.equal((await readdir(paths(f.appDataPath).bodiesRoot)).length,0);
			const staged = await f.media.catalogOriginals.readPage({ catalogId: CATALOG, importId: IMPORT });
			assert.equal(staged.roots.length, 1); assert.equal(staged.roots[0]?.photoId, entry.photo.id); assert.equal(staged.roots[0]?.sourceId, entry.photo.original.id);
			await f.media.catalogOriginals.promote(CATALOG, IMPORT, [entry.photo.id]);
			assert.equal((await f.media.catalogOriginals.readPage({ catalogId: CATALOG })).roots.length, 1);
			assert.equal(hash(await readFile(entry.file)), hash(entry.bytes));
		} finally { peer.close(); }
	});
});

void test('Lightscaper Current linked Catalog genuinely verifies retained six-recipe LUT/brush closure and reopens native tickets', options, async context => {
	await fixture(context, async f => {
		const entry = await f.rich(await f.prepare()); await f.publish(entry); const request = f.request(entry);
		assert.deepEqual((await f.catalog.loadPhoto(CATALOG, entry.photo.id))?.original, entry.photo.original);
		await f.reopen(); const opened = ticket(await f.tickets.transport.open(request), request);
		try { assert.equal(hash(bytes(await f.tickets.transport.read(opened, 0, entry.bytes.byteLength))), hash(entry.bytes)); }
		finally { await f.tickets.transport.close({ id: opened.id }); }
	});
});

void test('Lightscaper same-SHA genuine native locators retain distinct assets and independent actual custody', options, async context => {
	await fixture(context, async f => {
		const first = await f.prepare('first.dng'), second = await f.prepare('second.dng', first.bytes);
		assert.notEqual(first.input.facts.sourceId, second.input.facts.sourceId); assert.equal(first.input.facts.contentSha256, second.input.facts.contentSha256);
		await f.publish(first); await f.publish(second);
		const matches = await f.media.catalogOriginals.findDigestPage(hash(first.bytes));
		assert.deepEqual(new Set(matches.matches.map(value => value.assetId)), new Set([first.photo.original.storageKey,second.photo.original.storageKey]));
		const peer = f.peer(); try { assert.deepEqual(counts(peer), [2,2,2,2,0]); } finally { peer.close(); }
	});
});

void test('Lightscaper native input changed after its actual initial SHA cannot publish a matching-looking scalar prefix', options, async context => {
	await fixture(context, async f => {
		const entry = await f.prepare(), wrong = entry.bytes.slice(); wrong[wrong.length-1] = wrong[wrong.length-1]! ^ 1; await writeFile(entry.file,wrong); wrong.fill(0);
		await assert.rejects(f.linked.publishInput(entry.input, { catalogId: CATALOG, importId: IMPORT, photoId: entry.photo.id, original: entry.photo.original, metadata: {} }));
		const peer = f.peer(); try { assert.deepEqual(counts(peer), [0,0,0,0,0]); } finally { peer.close(); }
	});
});

void test('Lightscaper linked proof and owner admission reject forged/foreign values before borrowed reflection', options, async context => {
	await fixture(context, async f => {
		let reflected = 0; const poison = new Proxy({}, { ownKeys() { reflected++; throw new Error('must not reflect'); }, get() { reflected++; throw new Error('must not reflect'); } });
		await assert.rejects(withInput(poison, f.mediaDatabasePath, () => undefined)); assert.equal(reflected, 0);
		await assert.rejects(Linked.open({ appDataPath: f.appDataPath, grants: poison as never, scope: poison as never, unretired: () => undefined })); assert.equal(reflected, 0);
		const entry = await f.prepare(); await assert.rejects(withInput(entry.input, f.databasePath, () => undefined));
		await assert.rejects(f.linked.prepareInput(f.grant.grantId, [path('..')]));
		await f.publish(entry);
		await assert.rejects(f.linked.publishInput(entry.input, poison as never)); assert.equal(reflected, 0);
	});
});

void test('Lightscaper deleting an unretained linked asset atomically retires its typed identity but never external bytes', options, async context => {
	await fixture(context, async f => {
		const entry = await f.prepare(); await f.publish(entry); await assert.rejects(f.media.deleteAsset(entry.photo.original.storageKey));
		await f.media.catalogOriginals.release(CATALOG, [entry.photo.id]); await f.media.deleteAsset(entry.photo.original.storageKey);
		assert.equal(await f.media.getAssetMetadata(entry.photo.original.storageKey), null); assert.equal(hash(await readFile(entry.file)), hash(entry.bytes));
		const peer = f.peer(); try { assert.deepEqual(counts(peer), [0,0,0,0,0]); } finally { peer.close(); }
	});
});
