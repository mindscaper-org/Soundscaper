/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {installLightscaperManagedSmokeNativeObserverCurrentV1 as install} from '../desktop/lightscaper-managed-smoke-native-custody-current-v1.ts';
import {linkedWorkflowFixtureCurrentV1 as fixture,options,hash} from './helpers/lightscaper-native-linked-workflow-integration-fixture-current.ts';
void test('Main-only packaged observer authenticates actual linked full Photos and native custody without copying to managed storage',options,async context=>{
 const observer=install({scenario:'linked'});try{await fixture(context,async f=>{const files=[await f.file('One.dng'),await f.file('Two.dng')],{runtime}=await f.open(),ids:string[]=[];
  for(const name of ['One.dng','Two.dng']){const selected=await f.select(runtime,name);try{const result=await runtime.importEntries({scan:selected.scan,entryIds:[selected.entry.entryId]});const id=result[0]?.photoId;assert.ok(id);ids.push(id);}finally{await runtime.closeScan(selected.scan);}}
  const fixtures=files.map((file,index)=>({name:index===0?'One.dng':'Two.dng',mimeType:'image/x-adobe-dng',base64:Buffer.from(file.bytes).toString('base64'),byteLength:file.bytes.byteLength,sha256:hash(file.bytes)})),report=await observer.read(ids,fixtures);
  assert.equal(report.photos.length,2);for(const photo of report.photos){assert.equal(photo.storage,'native-photo-linked-original');assert.equal(photo.bodyVerified,true);assert.equal(photo.sha256,fixtures.find(file=>(photo.document as {metadata:{fileName:string}}).metadata.fileName===file.name)?.sha256);}
  const db=f.peer();try{assert.equal(db.prepare('SELECT count(*) AS n FROM native_photo_original_bindings').get()?.n,0);assert.equal(db.prepare("SELECT count(*) AS n FROM native_photo_media_identities WHERE kind='linked'").get()?.n,2);}finally{db.close();}
 });}finally{await observer.close();}
});
