/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync, constants, type SQLInputValue } from 'node:sqlite';
import test from 'node:test';
import { prepareLightscaperNativeSmartCollectionRootGuardCurrentV1 as prepare, assertLightscaperNativeSmartCollectionRootGuardCurrentV1 as assertGuard,
	auditLightscaperNativeSmartCollectionArchiveCurrentV1 as archiveAudit } from '../desktop/lightscaper-native-smart-collection-audit-current-v1.ts';
import { captureLightscaperNativeSmartCollectionContextCurrentV1 as capture } from '../desktop/lightscaper-native-smart-collection-context-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { photoSmartCollectionRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { normalizePhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { nativeStackQueryFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-stack-query-fixture-current.ts';
import { seedNativeSmartCollectionFixtureCurrentV1 as seed, insertNativeSmartCollectionFixtureCurrentV1 as insert,
	nativeSmartCollectionDefinitionFixtureCurrentV1 as definition } from './helpers/lightscaper-native-smart-collection-fixture-current.ts';

type GetArguments = SQLInputValue[] | [Record<string, SQLInputValue>, ...SQLInputValue[]];

function transaction<T>(db:DatabaseSync,run:()=>T):T{db.exec('BEGIN IMMEDIATE');try{const result=run();db.exec('COMMIT');return result;}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}}

test('Lightscaper native saved root proofs bind actual connection complete candidate context and single-use authority',async()=>{
	await fixture(async(db,path)=>{
		const f=seed(db,35), guard=await prepare(db,f.root,3), foreign=new DatabaseSync(path);
		try{
			transaction(foreign,()=>assert.throws(()=>assertGuard(guard,foreign,capture(foreign,'catalog',null),f.root),/foreign|audit|guard/iu));
			transaction(db,()=>assert.throws(()=>assertGuard(guard,db,capture(db,'catalog',null),{...f.root,name:'Different candidate'}),/candidate|root/iu));
			transaction(db,()=>{const context=capture(db,'catalog',null);assertGuard(guard,db,context,f.root);assert.throws(()=>assertGuard(guard,db,context,f.root),/consumed|audit|guard/iu);});
		}finally{foreign.close();}
	});
});

test('Lightscaper native saved root audit authenticates later definition collisions and references in negative branches',async()=>{
	await fixture(async db=>{
		const f=seed(db,35), candidate=normalizePhotoCatalogRootV1({...f.root,collections:[...f.root.collections,{id:f.definitions[34]!.id,name:'Collision',kind:'manual'}]});
		await assert.rejects(prepare(db,candidate,3),/disjoint|collision|saved/iu);
		const chosen=f.definitions[34]!, changed=normalizePhotoSmartCollectionV1({...chosen,query:{...chosen.query,predicate:{kind:'any',terms:[
			{kind:'presence',column:'iso',value:'known'},{kind:'not',term:{kind:'keyword',id:'keyword'}}]}}}),record=photoSmartCollectionRecordV1(changed);
		db.prepare('UPDATE native_photo_smart_collections SET document=?,reference_keys=? WHERE collection_key=?').run(JSON.stringify(changed),JSON.stringify(record.referenceKeys),record.key);
		await assert.rejects(prepare(db,normalizePhotoCatalogRootV1({...f.root,keywords:[]}),3),ReferenceError);assert.equal(db.isTransaction,false);
	});
});

for(const kind of ['definition','summary','projection'] as const)test(`Lightscaper native saved audit refuses later ${kind} inventory corruption without shortcut absence authority`,async()=>{
	await fixture(async db=>{
		const f=seed(db,35),key=f.key(34);
		if(kind==='definition')db.prepare('DELETE FROM native_photo_smart_collections WHERE collection_key=?').run(key);
		if(kind==='summary')db.prepare('DELETE FROM native_photo_smart_collection_summaries WHERE collection_key=?').run(key);
		if(kind==='projection')db.prepare('UPDATE native_photo_smart_collections SET reference_keys=? WHERE collection_key=?').run('[]',key);
		await assert.rejects(prepare(db,f.root,3));assert.equal(db.isTransaction,false);
	});
});

test('Lightscaper native saved full audit releases each read snapshot before yield and refuses an actual competing context commit',async()=>{
	await fixture(async(db,path)=>{
		const f=seed(db,35),writer=new DatabaseSync(path);
		const mutation=new Promise<void>((resolve,reject)=>{setTimeout(()=>{try{
			assert.equal(db.isTransaction,false);writer.prepare('UPDATE native_photo_catalogs SET index_revision=12 WHERE id=?').run('catalog');resolve();
		}catch(error){reject(error);}},0);});
		try{await assert.rejects(prepare(db,f.root,3),{code:'CATALOG_REVISION_CONFLICT'});await mutation;}finally{writer.close();}
	});
});

test('Lightscaper native saved root proof refuses context changes occurring after its completed audit',async()=>{
	await fixture(async db=>{
		const f=seed(db,1),guard=await prepare(db,f.root,3);db.prepare('UPDATE native_photo_smart_collection_states SET revision=8').run();
		transaction(db,()=>assert.throws(()=>assertGuard(guard,db,capture(db,'catalog',null),f.root),{code:'CATALOG_REVISION_CONFLICT'}));
	});
});

test('Lightscaper native saved audit refuses combined root collection overflow and physical absent-versus-empty state substitution',async()=>{
	await fixture(async db=>{
		const f=seed(db,1),collections=Array.from({length:10000},(_,i)=>({id:`manual-${String(i)}`,name:'Manual',kind:'manual' as const}));
		await assert.rejects(prepare(db,normalizePhotoCatalogRootV1({...f.root,collections}),3),RangeError);
	});
	await fixture(async db=>{
		const f=seed(db),guard=await prepare(db,f.root,3);db.prepare('INSERT INTO native_photo_smart_collection_states VALUES(?,0,0)').run('catalog');
		transaction(db,()=>assert.throws(()=>assertGuard(guard,db,capture(db,'catalog',null),f.root),{code:'CATALOG_REVISION_CONFLICT'}));
	});
});

test('Lightscaper native saved inventory audit cannot skip a later extra row when an indexed count looks plausible',async()=>{
	await fixture(async db=>{
		const f=seed(db,35);insert(db,definition(99));await assert.rejects(prepare(db,f.root,3),/count|inventory/iu);assert.equal(db.isTransaction,false);
	});
});

test('Lightscaper native saved audit bounds ten full definitions and64 audit keys per transaction without COUNT',async()=>{
	await fixture(async db=>{
		const f=seed(db,145),nativePrepare=db.prepare,nativeExec=db.exec,pages:{definitions:number;keys:number}[]=[];let page={definitions:0,keys:0};
		db.exec=function(sql:string){const result=Reflect.apply(nativeExec,db,[sql]);if(/^BEGIN/u.test(sql))page={definitions:0,keys:0};if(/^(COMMIT|ROLLBACK)/u.test(sql))pages.push(page);return result;};
		db.prepare=function(sql:string){const statement=Reflect.apply(nativePrepare,db,[sql]),get=statement.get;
			statement.get=function(...args:GetArguments){const row=Reflect.apply(get,statement,args) as ReturnType<typeof get>;if(row!==undefined){if(/FROM native_photo_smart_collections/u.test(sql)&&/\bdocument\b/u.test(sql))page.definitions++;
				if(/collection_key[ >]/u.test(sql)&&/ORDER BY collection_key/u.test(sql)&&!/^SELECT 1/u.test(sql))page.keys++;}return row;} as typeof get;return statement;};
		db.setAuthorizer((action,_table,column)=>action===constants.SQLITE_FUNCTION&&column?.toLowerCase()==='count'?constants.SQLITE_DENY:constants.SQLITE_OK);
		try{await prepare(db,f.root,3);assert.ok(pages.length>15);assert.ok(pages.every(p=>p.definitions<=10));assert.ok(pages.some(p=>p.definitions===10));
			assert.ok(pages.every(p=>p.keys<=68),'64 traversal keys plus fixed context probes');}
		finally{db.setAuthorizer(null);db.prepare=nativePrepare;db.exec=nativeExec;}
	});
});

test('Lightscaper native saved archive audit grants only scalar inventory proof and binds complete payload bytes',async()=>{
	await fixture(async db=>{
		const f=seed(db,1),first=await archiveAudit(db,'catalog');assert.equal(first.context.persistedState?.revision,7);
		assert.match(first.inventoryDigest,/^[a-f0-9]{64}$/u);transaction(db,()=>assert.throws(()=>assertGuard(first,db,capture(db,'catalog',null),f.root)));
		const changed=normalizePhotoSmartCollectionV1({...f.definitions[0]!,query:{...f.definitions[0]!.query,text:'changed'}}),record=photoSmartCollectionRecordV1(changed);
		db.prepare('UPDATE native_photo_smart_collections SET document=?,reference_keys=? WHERE collection_key=?').run(JSON.stringify(changed),JSON.stringify(record.referenceKeys),record.key);
		const second=await archiveAudit(db,'catalog');assert.equal(second.contextDigest,first.contextDigest);assert.notEqual(second.inventoryDigest,first.inventoryDigest);
	});
});


test('Lightscaper native saved audit charges both retained rich roots before its8MiB definition page allowance',async()=>{
	await fixture(async db=>{
		const f=seed(db,15),root=normalizePhotoCatalogRootV1({...f.root,keywords:[...f.root.keywords,...Array.from({length:9999},(_,i)=>({id:`word-${String(i).padStart(5,'0')}`,name:'k'.repeat(128),parentId:null}))]});
		db.prepare('UPDATE native_photo_catalogs SET document=?').run(serializeLightscaperDocumentV1(root));
		const terms=Array.from({length:255},()=>({kind:'text',column:'title',operator:'contains',value:'\ud800'.repeat(256)}));
		for(const old of f.definitions){const chosen=normalizePhotoSmartCollectionV1({...old,query:{...old.query,predicate:{kind:'all',terms}}}),record=photoSmartCollectionRecordV1(chosen);
			db.prepare('UPDATE native_photo_smart_collections SET document=?,reference_keys=? WHERE collection_key=?').run(JSON.stringify(chosen),JSON.stringify(record.referenceKeys),record.key);}
		const nativePrepare=db.prepare,nativeExec=db.exec;let current=0,maximum=0;
		db.exec=function(sql:string){const result=Reflect.apply(nativeExec,db,[sql]);if(/^BEGIN/u.test(sql))current=0;if(/^(COMMIT|ROLLBACK)/u.test(sql))maximum=Math.max(maximum,current);return result;};
		db.prepare=function(sql:string){const statement=Reflect.apply(nativePrepare,db,[sql]),get=statement.get;statement.get=function(...args:GetArguments){const row=Reflect.apply(get,statement,args) as ReturnType<typeof get>;if(row!==undefined&&/FROM native_photo_smart_collections/u.test(sql)&&/\bdocument\b/u.test(sql))current++;return row;} as typeof get;return statement;};
		try{await prepare(db,root,3);assert.ok(maximum>0&&maximum<10,'Root+context+record+scalar reserves must reduce a rich page below the10definition ceiling');}
		finally{db.prepare=nativePrepare;db.exec=nativeExec;}
	});
});
