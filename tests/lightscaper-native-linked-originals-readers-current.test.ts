/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { stat, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { linkedOriginalsFixtureCurrentV1 as fixture, options, CATALOG, hash, ticket, group, normalizePhotoDocumentCurrentV1 as photo,
	reference, GRANTED_FS_OP as OP, linkedBytesCurrentV1 as bytes } from './helpers/lightscaper-native-linked-originals-integration-fixture-current.ts';

void test('Lightscaper linked original traverses actual six ticket methods with every Photo alias retained', options, async context => {
	await fixture(context, async f => {
		const entry = await f.prepare(); await f.publish(entry); const request = f.request(entry), single = ticket(await f.tickets.transport.open(request), request);
		try { assert.equal(hash(bytes(await f.tickets.transport.read(single,0,entry.bytes.byteLength))), hash(entry.bytes)); }
		finally { await f.tickets.transport.close({id:single.id}); }
		const alias = photo({ ...entry.photo, id: 'independent-alias-photo', original: { ...entry.photo.original,id:'independent-alias-source' } });
		await f.media.catalogOriginals.retain(CATALOG,[reference(alias.original,alias.id)]);
		const root = await f.catalog.loadCatalog(CATALOG); assert.ok(root); await f.catalog.publishPhotos(CATALOG,root.revision,[alias]);
		const requests = [request,{catalogId:CATALOG,photoId:alias.id,original:alias.original}], opened = group(await f.tickets.transport.openGroup(requests),requests);
		try {
			for (let index=0; index<requests.length; index++) assert.equal(hash(bytes(await f.tickets.transport.readGroup({id:opened.id},index,0,entry.bytes.byteLength))),hash(entry.bytes));
			await assert.rejects(f.media.deleteAsset(entry.photo.original.storageKey));
		} finally { await f.tickets.transport.closeGroup({id:opened.id}); }
		assert.equal((await f.media.catalogOriginals.readPage({catalogId:CATALOG})).roots.length,2);
	});
});

void test('Lightscaper linked group refuses a missing alias authority without publishing its successful prefix or retaining pins', options, async context => {
	await fixture(context, async f => {
		const entry = await f.prepare(); await f.publish(entry); const request = f.request(entry);
		await assert.rejects(f.tickets.transport.openGroup([request,{...request,photoId:'absent-photo'}]));
		await f.media.catalogOriginals.release(CATALOG,[entry.photo.id]); await f.media.deleteAsset(entry.photo.original.storageKey);
		assert.equal(await f.media.getAssetMetadata(entry.photo.original.storageKey),null);
	});
});

void test('Lightscaper actual linked read verifies complete Original and custody but permits ordinary Photo attribute edits', options, async context => {
	await fixture(context, async f => {
		const entry=await f.prepare(); await f.publish(entry); const request=f.request(entry), opened=ticket(await f.tickets.transport.open(request),request);
		try {
			const current=await f.catalog.loadPhoto(CATALOG,entry.photo.id); assert.ok(current);
			await f.catalog.savePhoto(photo({...current,rating:current.rating===5?4:5}), current.revision);
			assert.equal(hash(bytes(await f.tickets.transport.read(opened,0,entry.bytes.byteLength))),hash(entry.bytes));
			await assert.rejects(f.tickets.transport.open({...request,original:{...request.original,name:'changed immutable name.dng'}}));
			await f.media.catalogOriginals.release(CATALOG,[entry.photo.id]); await assert.rejects(f.tickets.transport.read(opened,0,1));
		} finally { await f.tickets.transport.close({id:opened.id}); }
	});
});

void test('Lightscaper exact relink preserves old held native locator and gives new readers the new actual inode', options, async context => {
	await fixture(context, async f => {
		const first=await f.prepare('old.dng'); await f.publish(first); const request=f.request(first), old=ticket(await f.tickets.transport.open(request),request);
		let fresh: ReturnType<typeof ticket>|undefined;
		try {
			const next=await f.prepare('replacement.dng',first.bytes), a=await stat(first.file,{bigint:true}),b=await stat(next.file,{bigint:true});
			assert.equal(a.dev===b.dev&&a.ino===b.ino,false);
			const receipt=await f.linked.relink(f.binding(first),next.input,0); assert.equal(receipt.revision,1); assert.equal(receipt.assetId,first.photo.original.storageKey);
			assert.equal(hash(bytes(await f.tickets.transport.read(old,0,first.bytes.byteLength))),hash(first.bytes));
			fresh=ticket(await f.tickets.transport.open(request),request);
			const wrong=first.bytes.slice(); wrong[wrong.length-1]=wrong[wrong.length-1]!^1; await writeFile(first.file,wrong); wrong.fill(0);
			await assert.rejects(f.tickets.transport.read(old,0,1));
			assert.equal(hash(bytes(await f.tickets.transport.read(fresh,0,first.bytes.byteLength))),hash(first.bytes));
		} finally { await Promise.allSettled([f.tickets.transport.close({id:old.id}),...(fresh?[f.tickets.transport.close({id:fresh.id})]:[])]); }
	});
});

void test('Lightscaper linked relink rejects wrong actual bytes and stale locator CAS without replacing the immutable generation', options, async context => {
	await fixture(context, async f => {
		const entry=await f.prepare(); await f.publish(entry); const next=await f.prepare('next.dng',entry.bytes);
		await f.linked.relink(f.binding(entry),next.input,0);
		const stale=await f.prepare('stale.dng',entry.bytes); await assert.rejects(f.linked.relink(f.binding(entry),stale.input,0));
		const wrong=entry.bytes.slice(); wrong[wrong.length-1]=wrong[wrong.length-1]!^1; const invalid=await f.prepare('wrong.dng',wrong); wrong.fill(0);
		await assert.rejects(f.linked.relink(f.binding(entry),invalid.input,1));
		const peer=f.peer(); try { assert.equal(peer.prepare('SELECT revision FROM native_photo_linked_original_bindings WHERE storage_key=?').get(entry.photo.original.storageKey)?.revision,1); } finally { peer.close(); }
		assert.deepEqual((await f.catalog.loadPhoto(CATALOG,entry.photo.id))?.original,entry.photo.original);
	});
});

void test('Lightscaper existing shared logical Original budget refuses a linked group before native file IO', options, async context => {
	await fixture(context, async f => {
		const entry=await f.prepare(); await f.publish(entry); const booking=f.media.reserveOriginalGroup(4094), before=f.count(OP.fileOpen);
		try { await assert.rejects(f.tickets.transport.openGroup([f.request(entry)])); assert.equal(f.count(OP.fileOpen),before); }
		finally { booking.release(); }
	});
});
