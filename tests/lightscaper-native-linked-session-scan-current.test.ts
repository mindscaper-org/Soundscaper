/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir,symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { linkedSessionFixtureCurrentV1 as fixture,options,page,input,handle,bytes,hash } from './helpers/lightscaper-native-linked-session-integration-fixture-current.ts';
void test('Linked Session chooser and durable grant page expose only pathless actual grants',options,async context=>fixture(context,async f=>{
 const chosen=await f.run({operation:'choose-folder'});assert.ok(chosen&&typeof chosen==='object');assert.deepEqual(Object.keys(chosen).sort(),['displayName','grantId','revision','revoked']);
 const p=await f.run({operation:'grants',afterGrantId:null});assert.ok(p&&typeof p==='object'&&'grants'in p);assert.ok(Array.isArray(p.grants));assert.equal(p.grants.length,2);assert.equal(await f.run({operation:'available'}),true);
}));
void test('Linked Session actual scan pages are bounded, pathless and keep native component authority private',options,async context=>fixture(context,async f=>{
 for(let i=0;i<70;i++)await f.file(`scan-${String(i).padStart(3,'0')}.bin`,Uint8Array.of(i));
 const scan=await f.scan(),first=page(await f.run({operation:'scan-next',handle:scan}));assert.equal(first.entries.length,64);assert.equal(first.done,false);
 const ids=new Set(first.entries.map(e=>e.entryId)),next=page(await f.run({operation:'scan-next',handle:scan}));assert.ok(next.entries.length>0);assert.equal(next.done,true);assert.equal(next.entries.some(e=>ids.has(e.entryId)),false);
 await f.closeScan(scan);
}));
void test('Linked Session input admission refuses expired and forged scan observations before native file open',options,async context=>fixture(context,async f=>{
 await f.write();const selected=await f.pick('Selected native.DNG');await f.run({operation:'scan-next',handle:selected.scan});const before=f.count(4);
 await assert.rejects(f.run({operation:'input-open',scan:selected.scan,entryId:selected.entry.entryId}));await assert.rejects(f.run({operation:'input-open',scan:selected.scan,entryId:'f'.repeat(64)}));assert.equal(f.count(4),before);await f.closeScan(selected.scan);
}));
void test('Linked Session nested scan entry opens actual contained directory without exposing a renderer path',options,async context=>fixture(context,async f=>{
 const root=await f.scan(),chosen=await f.pick('nested',root),nested=await f.scan(f.grant.grantId,chosen.entry.entryId);await f.closeScan(root);
 const p=page(await f.run({operation:'scan-next',handle:nested}));assert.ok(p.entries.some(e=>e.displayName==='photo.bin'&&e.kind==='file'));await f.closeScan(nested);
}));
void test('Linked Session does not follow actual symlink entries or accept caller supplied native paths',options,async context=>fixture(context,async f=>{
 await mkdir(join(f.rootPath,'links'));await symlink(join(f.outside,'photo.bin'),join(f.rootPath,'escape.bin'));
 const chosen=await f.pick('escape.bin'),before=f.count(4);await assert.rejects(f.run({operation:'input-open',scan:chosen.scan,entryId:chosen.entry.entryId}));assert.equal(f.count(4),before);
 await assert.rejects(f.run({operation:'scan-open',grantId:f.grant.grantId,path:f.rootPath}));await f.closeScan(chosen.scan);
}));
void test('Linked Session actual input bytes survive scan retirement and remain bounded until explicit input close',options,async context=>fixture(context,async f=>{
 const e=await f.write(),selected=await f.open('Selected native.DNG');assert.equal(selected.facts.contentSha256,hash(e.bytes));assert.equal(selected.facts.byteLength,e.bytes.byteLength);assert.equal(selected.facts.modifiedTime,null);
 assert.equal(hash(bytes(await f.run({operation:'input-read',handle:selected.handle,offset:0,length:e.bytes.byteLength}))),hash(e.bytes));
 await assert.rejects(f.run({operation:'input-read',handle:selected.handle,offset:0,length:1048577}));await f.closeInput(selected);await assert.rejects(f.run({operation:'input-read',handle:selected.handle,offset:0,length:1}));
}));
void test('Linked Session input handles share the actual Main Session handle capacity with other families',options,async context=>fixture(context,async f=>{
 const bookings=Array.from({length:16},()=>f.handles.reserve('upload'));const before=f.count(2);
 try{await assert.rejects(f.scan());assert.equal(f.count(2),before);}finally{for(const booking of bookings)booking.abandon();}const scan=await f.scan();await f.closeScan(scan);
}));
void test('Linked Session closed handles reject purpose confusion without consuming a live actual input',options,async context=>fixture(context,async f=>{
 const e=await f.write(),selected=input(await f.open('Selected native.DNG'));await assert.rejects(f.run({operation:'scan-next',handle:selected.handle}));
 await assert.rejects(f.run({operation:'input-read',handle:handle({kind:'linked-input',id:'e'.repeat(64)},'linked-input'),offset:0,length:1}));
 assert.equal(hash(bytes(await f.run({operation:'input-read',handle:selected.handle,offset:0,length:e.bytes.byteLength}))),hash(e.bytes));await f.closeInput(selected);
}));
