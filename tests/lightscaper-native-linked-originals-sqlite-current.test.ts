/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { constants,DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { linkedOriginalsFixtureCurrentV1 as fixture, linkedCountsCurrentV1 as counts, options, CATALOG, IMPORT } from './helpers/lightscaper-native-linked-originals-integration-fixture-current.ts';

function actualMedia(db:DatabaseSync):boolean { return db.prepare("SELECT name FROM sqlite_schema WHERE name='native_photo_linked_original_bindings' AND type='table'").get()?.name==='native_photo_linked_original_bindings'; }
function observe(before:(db:DatabaseSync,sql:string)=>void,after:(db:DatabaseSync,sql:string)=>void):()=>void {
	const native=DatabaseSync.prototype.exec;
	DatabaseSync.prototype.exec=function(sql:string):void { before(this,sql); Reflect.apply(native,this,[sql]); after(this,sql); };
	return ()=>{DatabaseSync.prototype.exec=native;};
}

for (const table of ['native_photo_media_identities','native_photo_media_assets','native_photo_media_roots']) void test(`Lightscaper linked ${table} refusal rolls back the genuine preceding publication prefix`,options,async context=>{
	await fixture(context,async f=>{
		const entry=await f.prepare(),peer=f.peer();
		try {
			peer.exec(`CREATE TRIGGER deny_linked BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'linked publication refused'); END`);
			try { await assert.rejects(f.linked.publishInput(entry.input,{catalogId:CATALOG,importId:IMPORT,photoId:entry.photo.id,original:entry.photo.original,metadata:{}})); }
			finally {peer.exec('DROP TRIGGER deny_linked');}
			assert.deepEqual(counts(peer),[0,0,0,0,0]); assert.equal(peer.isTransaction,false);
		} finally {peer.close();}
	});
});

void test('Lightscaper linked actual COMMIT denial rolls back leaf parent asset and staged custody together',options,async context=>{
	await fixture(context,async f=>{
		const entry=await f.prepare(); let selected:DatabaseSync|undefined,denied=0;
		const restore=observe((db,sql)=>{
			if(!/^BEGIN IMMEDIATE\s*;?$/iu.test(sql.trim())||!actualMedia(db))return;
			selected=db;db.setAuthorizer((action,target)=>{if(action===constants.SQLITE_TRANSACTION&&target==='COMMIT'){denied++;return constants.SQLITE_DENY;}return constants.SQLITE_OK;});
		},()=>undefined);
		try {await assert.rejects(f.linked.publishInput(entry.input,{catalogId:CATALOG,importId:IMPORT,photoId:entry.photo.id,original:entry.photo.original,metadata:{}}));}
		finally {selected?.setAuthorizer(null);restore();}
		assert.equal(denied,1);assert.ok(selected);assert.equal(selected.isTransaction,false);
		const peer=f.peer();try{assert.deepEqual(counts(peer),[0,0,0,0,0]);}finally{peer.close();}
	});
});

void test('Lightscaper linked true SQL publication ACK survives opaque caller abort and reentrant owner close',options,async context=>{
	await fixture(context,async f=>{
		const entry=await f.prepare(),caller=new AbortController();let reflected=0,commits=0,closing:Promise<void>|undefined;
		const reason=new Proxy({}, {get(){reflected++;throw new Error('must not reflect late abort');},ownKeys(){reflected++;return[];}});
		const restore=observe(()=>undefined,(db,sql)=>{
			if(!/^COMMIT\s*;?$/iu.test(sql.trim())||!actualMedia(db)||!db.prepare('SELECT 1 FROM native_photo_media_assets WHERE source_id=?').get(entry.photo.original.storageKey))return;
			commits++;caller.abort(reason);closing=f.linked.close();
		});
		let receipt:Record<string,unknown>;
		try {receipt=await f.linked.publishInput(entry.input,{catalogId:CATALOG,importId:IMPORT,photoId:entry.photo.id,original:entry.photo.original,metadata:{}},{signal:caller.signal});}
		finally {restore();}
		assert.equal(receipt.sourceId,entry.photo.original.storageKey);assert.equal(commits,1);assert.equal(reflected,0);assert.ok(closing);
		await entry.input.close();await closing;
		const peer=f.peer();try{assert.deepEqual(counts(peer),[1,1,1,1,0]);}finally{peer.close();}
	});
});
