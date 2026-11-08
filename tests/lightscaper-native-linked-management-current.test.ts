/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {linkedOriginalsFixtureCurrentV1 as native,GRANTED_FS_OP as OP,CATALOG} from './helpers/lightscaper-native-linked-originals-integration-fixture-current.ts';
import {linkedWorkflowFixtureCurrentV1 as fixture,options,hash} from './helpers/lightscaper-native-linked-workflow-integration-fixture-current.ts';
void test('Actual complete Current linked management authenticates stored Photo/custody and exact relink retains immutable Original identity',options,async context=>fixture(context,async f=>{
 const entry=await f.file(),{runtime}=await f.open(),selected=await f.select(runtime),items=await runtime.importEntries({scan:selected.scan,entryIds:[selected.entry.entryId]});await runtime.closeScan(selected.scan);const photoId=items[0]?.photoId;assert.ok(photoId);
 const before=await f.catalog.loadPhoto(f.catalogId,photoId);assert.ok(before);const page=await runtime.readOriginalsPage(),row=page.rows.find(value=>value.photoId===photoId);assert.ok(row);assert.equal(row.status,'present');assert.equal(row.locatorRevision,0);assert.equal(row.binding.sha256,hash(entry.bytes));assert.equal(row.binding.assetId,before.original.storageKey);assert.equal('path'in row,false);assert.equal('locator'in row,false);
 const target=join(f.rootPath,'Moved native.DNG');await rename(entry.file,target);const missing=await runtime.inspectOriginal(row.binding);assert.equal(missing.status,'unavailable');assert.equal(missing.reason,'file-missing');
 const replacement=await f.select(runtime,'Moved native.DNG');try{const receipt=await runtime.relinkEntry({scan:replacement.scan,entryId:replacement.entry.entryId},row.binding,row.locatorRevision);assert.equal(receipt.assetId,row.binding.assetId);assert.equal(receipt.revision,1);assert.equal(receipt.sha256,row.binding.sha256);
  const current=await runtime.inspectOriginal(row.binding);assert.equal(current.status,'present');assert.equal(current.locatorRevision,1);const stored=await f.catalog.loadPhoto(f.catalogId,photoId);assert.ok(stored);assert.deepEqual(stored.original,before.original);assert.equal(stored.revision,before.revision);
 }finally{await runtime.closeScan(replacement.scan);}
}));
void test('Linked inspection distinguishes genuine missing from corruption; a changed body never becomes offline-unavailable',options,async context=>fixture(context,async f=>{
 const entry=await f.file(),{runtime}=await f.open(),selected=await f.select(runtime);await runtime.importEntries({scan:selected.scan,entryIds:[selected.entry.entryId]});await runtime.closeScan(selected.scan);const row=(await runtime.readOriginalsPage()).rows[0];assert.ok(row);
 const altered=entry.bytes.slice();altered[altered.length-1]=altered[altered.length-1]!^1;await writeFile(entry.file,altered);await assert.rejects(runtime.inspectOriginal(row.binding));assert.equal((await f.catalog.loadPhoto(f.catalogId,row.photoId))?.original.contentSha256,row.binding.sha256);
}));
void test('Linked inspection authenticates exact retained custody again after actual held native body IO',options,async context=>native(context,async f=>{
 const entry=await f.prepare();await f.publish(entry);const hold=f.native.hold(OP.read),reading=f.track(f.linked.inspect(f.binding(entry)));try{await hold.entered;await f.media.catalogOriginals.release(CATALOG,[entry.photo.id]);hold.release();await assert.rejects(reading);}finally{hold.release();await Promise.allSettled([reading]);}
}));
