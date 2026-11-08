/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { saveLightscaperNativeSmartCollectionCurrentV1 as save, deleteLightscaperNativeSmartCollectionCurrentV1 as remove,
	admitLightscaperNativeSmartCollectionSaveCurrentV1 as admit, saveAdmittedLightscaperNativeSmartCollectionCurrentV1 as saveAdmitted } from '../desktop/lightscaper-native-smart-collection-transactions-current-v1.ts';
import { normalizePhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { nativeStackQueryFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-stack-query-fixture-current.ts';
import { nativeSmartCollectionDefinitionFixtureCurrentV1 as definition, seedNativeSmartCollectionFixtureCurrentV1 as seed } from './helpers/lightscaper-native-smart-collection-fixture-current.ts';

const options = (root=3,index=11,state=0) => ({ expectedCatalogRevision:root,expectedIndexRevision:index,expectedStateRevision:state });
const all = (db:DatabaseSync) => ['native_photo_catalogs','native_photo_smart_collections','native_photo_smart_collection_summaries','native_photo_smart_collection_states'].map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());

test('Lightscaper native saved create edit delete and recreate retain epochs without query readiness or Photo writes', async()=>{
	await fixture(async(db,path)=>{
		seed(db); const initial = normalizePhotoSmartCollectionV1({...definition(),revision:0});
		const created = await save(db,initial,null,options()); assert.equal(created.definition?.revision,0); assert.equal(created.catalogRevision,4); assert.equal(created.indexRevision,12); assert.equal(created.state.revision,1);
		const edited = await save(db,{...initial,name:'Changed'},0,options(4,12,1)); assert.equal(edited.definition?.revision,1); assert.equal(edited.state.collectionCount,1);
		const deleted = await remove(db,'catalog',initial.id,1,options(5,13,2)); assert.equal(deleted.definition,null); assert.equal(deleted.state.revision,3); assert.equal(deleted.state.collectionCount,0);
		const reopened = new DatabaseSync(path); try { assert.equal(reopened.prepare('SELECT revision FROM native_photo_smart_collection_states').get()?.revision,3); } finally { reopened.close(); }
		const recreated = await save(db,initial,null,options(6,14,3)); assert.equal(recreated.definition?.revision,0); assert.equal(recreated.state.revision,4);
		assert.deepEqual(Object.keys(recreated).sort(),['catalogId','catalogRevision','definition','indexRevision','kind','schemaVersion','state']);
		for(const table of ['native_photos','native_photo_query_rows_v1','native_photo_query_rows_v2','native_photo_query_builds_v1','native_photo_query_builds_v2','native_photo_stacks']) assert.equal(db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get(),undefined);
	});
});

test('Lightscaper native saved request capture is closed branded and detached before queue waits',async()=>{
	await fixture(async db=>{
		seed(db); const authored={...definition(),revision:0,name:'Captured'}, request=admit(authored,null,options()); authored.name='Later';
		assert.equal((await saveAdmitted(db,request)).definition?.name,'Captured'); let getters=0;
		assert.throws(()=>admit({...authored,get query(){getters++;return authored.query;}},null,options())); assert.equal(getters,0);
		await assert.rejects(saveAdmitted(db,{...request}),/admitted|owning/iu);
		assert.throws(()=>admit(authored,null,{...options(),callback:()=>undefined}));
	});
});

for(const stale of ['root','index','state','definition'] as const) test(`Lightscaper native saved ${stale} compare-and-swap rejects without partial mutation`,async()=>{
	await fixture(async db=>{
		seed(db,1); const before=all(db), chosen=definition(), opts=options(3,11,7);
		if(stale==='root') opts.expectedCatalogRevision=2; if(stale==='index') opts.expectedIndexRevision=10; if(stale==='state') opts.expectedStateRevision=6;
		const candidate=normalizePhotoSmartCollectionV1({...chosen,revision:stale==='definition'?1:2});
		await assert.rejects(save(db,candidate,stale==='definition'?1:2,opts),{name:'PhotoSmartCollectionRevisionConflictError'}); assert.deepEqual(all(db),before); assert.equal(db.isTransaction,false);
	});
});

for(const table of ['native_photo_smart_collections','native_photo_smart_collection_summaries','native_photo_smart_collection_states','native_photo_catalogs']) test(`Lightscaper native saved actual ${table} trigger refusal rolls back all publication`,async()=>{
	await fixture(async db=>{
		seed(db);const before=all(db), event=table==='native_photo_catalogs'?'UPDATE':'INSERT';
		db.exec(`CREATE TRIGGER saved_refuse BEFORE ${event} ON ${table} BEGIN SELECT RAISE(ABORT,'owned saved SQL failure'); END`);
		await assert.rejects(save(db,{...definition(),revision:0},null,options()),/owned saved SQL failure/u); assert.deepEqual(all(db),before);assert.equal(db.isTransaction,false);
	});
});

test('Lightscaper native saved final internal CAS rejects native trigger interference and rolls back both facts',async()=>{
	for(const target of ['index','state']) await fixture(async db=>{
		seed(db,1); const before=all(db);
		db.exec(`CREATE TRIGGER saved_interfere AFTER UPDATE ON native_photo_smart_collections BEGIN ${target==='index'?'UPDATE native_photo_catalogs SET index_revision=index_revision+1':'UPDATE native_photo_smart_collection_states SET revision=revision+1'}; END`);
		await assert.rejects(save(db,definition(),2,options(3,11,7))); assert.deepEqual(all(db),before);
	});
});

test('Lightscaper native saved opaque cancellation joins audit snapshots and late abort preserves durable receipt',async()=>{
	await fixture(async db=>{
		seed(db,35); const before=all(db), stop=new AbortController(); let traps=0;
		const reason=new Proxy({},{get(){traps++;throw Error('Opaque');},getPrototypeOf(){traps++;throw Error('Opaque');}});
		const retired=new Promise<void>((resolve,reject)=>{setTimeout(()=>{try{assert.equal(db.isTransaction,false);stop.abort(reason);resolve();}catch(error){reject(error);}},0);});
		let failure:unknown;try{await save(db,{...definition(99),revision:0},null,{...options(3,11,7),signal:stop.signal});}catch(error){failure=error;}
		await retired;assert.equal(failure,reason);assert.equal(traps,0);assert.deepEqual(all(db),before);
		const late=new AbortController(),receipt=await save(db,{...definition(99),revision:0},null,{...options(3,11,7),signal:late.signal});late.abort(reason);
		assert.equal(receipt.catalogRevision,4);assert.equal(receipt.state.collectionCount,36);assert.equal(traps,0);
	});
});
