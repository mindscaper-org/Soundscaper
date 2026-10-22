/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {rename} from 'node:fs/promises';
import {join} from 'node:path';
import {getDesktopPhotoDevelopAvailabilityCurrentV1 as availability} from '../src/lightscaper/desktop-photo-develop-availability-current-v1.ts';
import {offlineLinkedDevelopFixtureCurrentV1 as fixture,hash,options} from './helpers/lightscaper-native-linked-offline-develop-fixture-current.ts';

void test('A genuine acknowledged fit-screen cache survives selected Session/component reopen with its linked source offline',options,async context=>fixture(context,async f=>{
 assert.equal(f.cached.outcome,'ready');const first=f.cached.preview;assert.equal(first.tier,'fit-screen');assert.equal(first.descriptor.width,32);assert.equal(first.descriptor.height,32);assert.equal(f.cached.cache,'stored');
 const original=new Uint8Array(await first.body.arrayBuffer());
 try{
  assert.equal(hash(original),first.outputSha256);await f.session.close();await rename(f.file.file,join(f.rootPath,'Offline after actual cache ACK.DNG'));
  const {session}=await f.open(),source=availability(session.develop);assert.ok(source);assert.deepEqual(await source.read({photoId:f.photoId,expectedRevision:f.revision}),{quality:'preview-derivative',locatorRevision:0});
  const created=f.workers.statistics.created,reopened=await f.track(session.readPreview(f.photoId,'fit-screen',{expectedRevision:f.revision}));assert.equal(reopened.outcome,'ready');assert.equal(reopened.cache,'hit');assert.equal(f.workers.statistics.created,created,'A durable cached result must not invent another successful source decode.');
  const bytes=new Uint8Array(await reopened.preview.body.arrayBuffer());try{assert.equal(bytes.byteLength,first.byteLength);assert.equal(hash(bytes),first.outputSha256);assert.equal(reopened.preview.outputSha256,first.outputSha256);}finally{bytes.fill(0);}
  const full=session.develop.original;assert.ok(full);await assert.rejects(full.withFrame({schemaVersion:1,photoId:f.photoId,expectedRevision:f.revision},()=>{assert.fail('An offline cache cannot grant full Original output.');}));
  const stored=await session.develop.read({schemaVersion:3,photoId:f.photoId});assert.equal(stored.revision,f.revision);const metadata=await session.readMetadata(f.photoId);assert.equal(metadata.originalSha256,f.photo.original.contentSha256);
 }finally{original.fill(0);}
}));
