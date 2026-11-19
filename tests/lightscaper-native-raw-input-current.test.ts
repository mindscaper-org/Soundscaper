/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { nativeRawInputFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-raw-input-fixture-current.ts';
import { nativeRawOriginalsHashCurrentV1 as hash } from './helpers/lightscaper-native-raw-originals-fixture-current.ts';
import { nativeRawNeutralOracleCurrentV1 as oracle } from './helpers/lightscaper-native-raw-engine-fixture-current.ts';
import { rawRecoveryDngFixtureV1 } from './helpers/lightscaper-raw-recovery-dng-current-fixture.ts';
import { preparePhotoImportGestureCurrentV1 } from '../src/lightscaper/import/photo-import-preparation-current-v1.ts';
import { capturePhotoLibraryRawImportSourceCurrentV1 as capture } from '../src/lightscaper/controller/photo-library-raw-import-current-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
const bytes = (frame: Readonly<PixelFrameV1>) => new Uint8Array(frame.pixels.buffer, frame.pixels.byteOffset, frame.pixels.byteLength);
async function pending(work: Promise<unknown>): Promise<boolean> { let done=false; void work.then(()=>{done=true;},()=>{done=true;}); await setImmediate(); return !done; }

void test('Native RAW import source captures actual prototype method receiver without a stored Photo purpose', () => {
 const received = new Set<object>();
 class Source { withFrame() { received.add(this); return Promise.resolve({outcome:'web-fallback' as const,reason:'native-unavailable' as const}); } }
 const owner=new Source(), source=capture(owner); assert.ok(source); Object.defineProperty(owner,'withFrame',{get(){throw new Error('Late replacement.');}});
 return source.withFrame({body:new Blob([Uint8Array.of(1)]),contentSha256:'a'.repeat(64),profile:'canonical'},()=>undefined).then(value=>{assert.equal(value.outcome,'web-fallback');assert.equal(received.size,1);assert.equal(received.has(owner),true);});
});

void test('Native RAW genuine completed upload decodes canonical pixels before any stored Photo exists for that input', { timeout:15000 }, async context => {
 await fixture(context, async f => {
  const input=f.bytes.slice(); let expected:Awaited<ReturnType<typeof oracle>>|undefined,held:Readonly<PixelFrameV1>|undefined;
  try {
   expected=await oracle(input);const original=expected,id=await f.input();
   const result=await f.track(f.owner.withFrame(id,view=>{held=view.frame;assert.equal(view.decoder.engine,'lightscaper-libraw-native');assert.equal(view.profile,'canonical');
    assert.deepEqual(view.frame.descriptor,original.frame.descriptor);assert.equal(hash(bytes(view.frame)),hash(bytes(original.frame)));assert.equal(f.activeChildren(),0);return 'native input';},{signal:f.signal}));
   assert.equal(result.outcome,'native');if(result.outcome==='native')assert.equal(result.value,'native input');assert.deepEqual(f.sourceEvents,['entered','retired']);
   assert.ok(held);assert.ok(held.pixels.every(sample=>sample===0));assert.equal(f.state.alerts,0);
  } finally {input.fill(0);expected?.frame.pixels.fill(0);}
 });
});

void test('Native RAW input rejects an unknown handle without opening a decoder or fabricating fallback', { timeout:15000 }, async context => {
 await fixture(context,async f=>{let entered=0;await assert.rejects(f.track(f.owner.withFrame('f'.repeat(64),()=>{entered++;})));assert.equal(entered,0);assert.equal(f.state.starts,0);assert.equal(f.state.prepares,0);});
});

void test('Native RAW input preserves opaque consumer failure after joining actual completed-file retirement', { timeout:15000 }, async context => {
 await fixture(context,async f=>{const id=await f.input(),reason=Symbol('actual input consumer');await f.track(f.owner.withFrame(id,()=>{throw reason;})).then(()=>assert.fail('Opaque consumer unexpectedly succeeded.'),error=>{assert.equal(error,reason);});
  assert.deepEqual(f.sourceEvents,['entered','retired']);assert.equal(f.activeChildren(),0);assert.equal(f.state.alerts,0);});
});

void test('Native RAW input close joins held real plane consumer and completed upload callback', { timeout:15000 }, async context => {
 await fixture(context,async f=>{const id=await f.input(),entered=f.gate(),release=f.gate();let held:Readonly<PixelFrameV1>|undefined,before='';
  const work=f.track(f.owner.withFrame(id,async view=>{held=view.frame;before=hash(bytes(view.frame));entered.release();await release.promise;}));let close:Promise<void>|undefined;
  try {await f.reached(entered.promise,work);close=f.owner.close();assert.equal(await pending(close),true);assert.ok(held);assert.equal(hash(bytes(held)),before);assert.deepEqual(f.sourceEvents,['entered']);
   release.release();await Promise.allSettled([work]);await close;assert.deepEqual(f.sourceEvents,['entered','retired']);assert.ok(held.pixels.every(sample=>sample===0));}
  finally {release.release();await Promise.allSettled([work,...(close?[close]:[])]);}
 });
});

void test('Current RAW import preparation uses actual uploaded native plane and retires it before prepared publication', { timeout:15000 }, async context => {
 await fixture(context,async f=>{const root=await f.components.catalog.loadCatalog(f.photo.catalogId);assert.ok(root);const file=new File([f.bytes],'Uploaded native.DNG',{type:'image/png',lastModified:0});
  const stream=preparePhotoImportGestureCurrentV1({files:[file],catalog:root,createdAt:'2026-10-18T00:00:00.000Z',signal:f.signal,
   ownership:[{photoId:'input-photo',originalId:'input-original',originalStorageKey:'input-body',masterVersionId:'input-master'}]}, {rawImport:f.source});
  try {const result=await f.track(stream.next());assert.equal(result.done,false);assert.equal(result.value?.outcome,'prepared');assert.ok(result.value?.outcome==='prepared');
   assert.equal(result.value.photo.original.storageKey,'input-body');assert.equal(result.value.photo.original.contentSha256,hash(f.bytes));assert.equal(result.value.photo.original.width,f.photo.original.width);
   assert.equal(result.value.photo.original.mimeType,'image/x-adobe-dng');assert.equal(Object.hasOwn(result.value,'decodeArtifact'),false);assert.equal(f.state.starts,1);assert.deepEqual(f.sourceEvents,['entered','retired']);}
  finally {await stream.return(undefined);}
 });
});

void test('Complete native Current Session File import reaches actual prepublication RAW purpose and real catalog/custody publication', { timeout:15000 }, async context => {
 await fixture(context,async f=>{const generated=rawRecoveryDngFixtureV1({variant:'recovery'});generated.sensor.fill(0);
  try {const session=await f.openSession(f.source),items=await f.track(session.importFiles([new File([generated.bytes],'New native.DNG',{type:'application/octet-stream',lastModified:0})]));
   assert.equal(items.length,1);assert.equal(items[0]?.status,'imported');const photoId=items[0]?.photoId;assert.ok(photoId);assert.equal(f.state.starts,1);assert.deepEqual(f.sourceEvents,['entered','retired']);
   await session.close();const actual=await f.scopes.openComponents(f.selected.scope);try{const photo=await actual.catalog.loadPhoto(f.photo.catalogId,photoId);assert.ok(photo);assert.equal(photo.original.contentSha256,hash(generated.bytes));
    assert.equal(photo.original.name,'New native.DNG');assert.equal(photo.original.width,generated.width);assert.equal(photo.original.height,generated.height);await actual.media.verifyOriginal(photo.original);
    const page=await actual.media.catalogOriginals.readPage({catalogId:f.photo.catalogId});assert.ok(page.roots.some(item=>item.photoId===photoId));}
   finally{await actual.close();}
  } finally {generated.bytes.fill(0);}
 });
});
