/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { nativeRawNeutralOracleCurrentV1, nativeRawRecoveryOracleCurrentV1 } from './helpers/lightscaper-native-raw-engine-fixture-current.ts';
import { nativeRawOriginalsFixtureCurrentV1 as fixture, nativeRawOriginalsHashCurrentV1 as hash } from './helpers/lightscaper-native-raw-originals-fixture-current.ts';
import { scopeOriginalReferenceCurrentV1 as reference } from './helpers/lightscaper-native-library-scope-integration-fixture-current.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { setImageDevelopRawDevelopmentCurrentV1 } from '../src/common/editor/imaging/image-develop-raw-development-current-v1.ts';
import { prepareImageDevelopRawSourceCurrentV1 } from '../src/common/editor/imaging/image-develop-raw-source-current-v1.ts';
import { LightscaperNativePhotoMediaCurrentV1 as Media } from '../desktop/lightscaper-native-photo-media-current-v1.ts';
import { normalizeBinaryDerivativeCacheIdentityV1 } from '../src/common/editor/storage/binary-derivative-cache-records.ts';
import type { BinaryDerivativeCachePortV1 } from '../src/common/editor/storage/binary-derivative-cache-repository.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
const bytes = (frame: Readonly<PixelFrameV1>) => new Uint8Array(frame.pixels.buffer, frame.pixels.byteOffset, frame.pixels.byteLength);
async function pending(work: Promise<unknown>): Promise<boolean> { let done = false; void work.then(() => { done = true; }, () => { done = true; }); await setImmediate(); return !done; }

void test('Native stored RAW source owns actual selected Photo/custody and genuine peer through full neutral callback', { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  const input = f.bytes.slice(); let expected: Awaited<ReturnType<typeof nativeRawNeutralOracleCurrentV1>> | undefined, held: Readonly<PixelFrameV1> | undefined;
  try {
   expected = await nativeRawNeutralOracleCurrentV1(input); const output = expected;
   const result = await f.track(f.raw.withFrame(f.request(), view => {
    assert.equal(view.decoder.engine, 'lightscaper-libraw-native'); assert.equal(view.decoder.profile, 'neutral-linear-srgb16');
    assert.equal(view.decoder.profileVersion, 1); assert.equal(view.profile, 'canonical'); assert.equal(view.frame.descriptor.sampleFormat, 'unorm16');
    assert.deepEqual(view.frame.descriptor, output.frame.descriptor); assert.equal(hash(bytes(view.frame)), hash(bytes(output.frame)));
    assert.equal(view.contentSha256, hash(bytes(view.frame))); assert.equal(f.activeChildren(), 0); held = view.frame; return 'native callback';
   }, { signal: f.signal }));
   assert.equal(result.outcome, 'native'); if (result.outcome === 'native') assert.equal(result.value, 'native callback');
   assert.ok(held); assert.ok(held.pixels.every(value => value === 0)); assert.equal(f.state.starts, 1); assert.equal(f.state.alerts, 0);
  } finally { input.fill(0); expected?.frame.pixels.fill(0); }
 });
});

for (const profile of ['linear-headroom-v1', 'highlight-recovery-v1'] as const) void test(`Native stored ${profile} authenticates full Float32 source and explicit native profile`, { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  const input = f.bytes.slice(); let expected: Awaited<ReturnType<typeof nativeRawRecoveryOracleCurrentV1>> | undefined;
  try {
   expected = await nativeRawRecoveryOracleCurrentV1(input, profile); const output = expected;
   const result = await f.track(f.raw.withFrame(f.request(profile), view => {
    assert.equal(view.profile, profile); assert.equal(view.decoder.profile, profile === 'linear-headroom-v1' ? 'linear-headroom-f32' : 'highlight-recovery-f32');
    assert.deepEqual(view.frame.descriptor, output.frame.descriptor); assert.ok(view.frame.pixels instanceof Float32Array);
    assert.equal(view.rawFlip, output.rawFlip); assert.ok(Math.abs(view.exposureScale - output.exposureScale) <= 1e-12);
    let difference = 0; for (let index = 0; index < view.frame.pixels.length; index++) difference = Math.max(difference, Math.abs(view.frame.pixels[index]! - output.frame.pixels[index]!));
    assert.ok(difference <= 2e-6, `Actual native Float32 maximum difference ${difference}.`);
    assert.equal(view.contentSha256, hash(bytes(view.frame))); assert.equal(f.activeChildren(), 0);
   })); assert.equal(result.outcome, 'native'); assert.equal(f.state.alerts, 0);
  } finally { input.fill(0); expected?.frame.pixels.fill(0); }
 });
});

void test('Native stored RAW refuses substituted full Original and stale revision before starting a real process', { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  let entered = 0;
  await assert.rejects(f.track(f.raw.withFrame({ ...f.request(), original: { ...f.photo.original, name: 'Substituted.dng' } }, () => { entered++; })));
  await assert.rejects(f.track(f.raw.withFrame({ ...f.request(), expectedRevision: f.photo.revision + 1 }, () => { entered++; })));
  assert.equal(entered, 0); assert.equal(f.state.starts, 0); assert.equal(f.state.prepares, 0);
  const result = await f.track(f.raw.withFrame(f.request(), () => undefined)); assert.equal(result.outcome, 'native');
 });
});

void test('Native RAW exact revision fence refuses a real attribute edit after consumer entry without manufacturing fallback', { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  const entered = f.gate(), release = f.gate();
  const work = f.track(f.raw.withFrame(f.request(), async () => { entered.release(); await release.promise; }));
  try {
   await f.reached(entered.promise, work);
   await f.components.catalog.savePhoto({ ...f.photo, rating: 3 }, f.photo.revision);
   release.release(); await assert.rejects(work); assert.equal(f.state.alerts, 0);
  } finally { release.release(); await Promise.allSettled([work]); }
 });
});

void test('Native RAW null revision allows attributes while retaining full immutable Original through real callback', { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  const entered = f.gate(), release = f.gate();
  const work = f.track(f.raw.withFrame(f.request('canonical', null), async () => { entered.release(); await release.promise; return 'attributes allowed'; }));
  try {
   await f.reached(entered.promise, work); await f.components.catalog.savePhoto({ ...f.photo, rating: 2 }, f.photo.revision);
   release.release(); const result = await work; assert.equal(result.outcome, 'native'); if (result.outcome === 'native') assert.equal(result.value, 'attributes allowed');
  } finally { release.release(); await Promise.allSettled([work]); }
 });
});

void test('Native RAW retains actual Original deletion pin through consumer and close joins the real callback', { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  const entered = f.gate(), release = f.gate(); let held: Readonly<PixelFrameV1> | undefined, before = '';
  const work = f.track(f.raw.withFrame(f.request(), async view => { held = view.frame; before = hash(bytes(view.frame)); entered.release(); await release.promise; }));
  let close: Promise<void> | undefined;
  try {
   await f.reached(entered.promise, work); await f.components.media.catalogOriginals.release(f.photo.catalogId, [f.photo.id]);
   await assert.rejects(f.components.media.deleteAsset(f.photo.original.storageKey));
   await f.components.media.catalogOriginals.retain(f.photo.catalogId, [reference(f.photo.original, f.photo.id)]);
   close = f.native.close(); assert.equal(f.native.close(), close); assert.equal(await pending(close), true); assert.ok(held); assert.equal(hash(bytes(held)), before);
   release.release(); await Promise.allSettled([work]); await close; assert.ok(held.pixels.every(value => value === 0)); assert.equal(f.state.alerts, 0);
  } finally { release.release(); await Promise.allSettled([work, ...(close ? [close] : [])]); }
 });
});

void test('Complete Current Session full canonical Original actually forwards through native Reader/peer without a renderer File stage', { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  const session = await f.openSession(), port = session.develop.original; assert.ok(port);
  const input = f.bytes.slice(); let expected: Awaited<ReturnType<typeof nativeRawNeutralOracleCurrentV1>> | undefined, held: Readonly<PixelFrameV1> | undefined;
  try {
   expected = await nativeRawNeutralOracleCurrentV1(input); const output = expected;
   await f.track(port.withFrame({ schemaVersion: 1, photoId: f.photo.id, expectedRevision: f.photo.revision }, view => {
    assert.equal(view.revision, f.photo.revision); assert.equal(view.frame.descriptor.sampleFormat, 'unorm16');
    assert.deepEqual(view.frame.descriptor, output.frame.descriptor); assert.equal(hash(bytes(view.frame)), hash(bytes(output.frame))); held = view.frame;
   }));
   assert.ok(f.state.starts > 0, 'The complete Current child must reach the real native service.'); assert.equal(f.activeChildren(), 0);
   assert.equal(f.storage.events.filter(event => event === 'get-file').length, 0, 'Native decode must use actual Main reader authority without a redundant renderer File copy.');
   assert.ok(held); assert.ok(held.pixels.every(value => value === 0));
  } finally { input.fill(0); expected?.frame.pixels.fill(0); }
 });
});

for (const [mode, profile] of [['headroom', 'linear-headroom-v1'], ['recovery', 'highlight-recovery-v1']] as const) void test(`Complete Current ${mode} native source reaches actual full/proxy render with live fixed-profile authority`, { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  const session = await f.openSession(), port = session.develop.original; assert.ok(port); assert.ok(port.withDerivedFrame);
  const develop = setImageDevelopRawDevelopmentCurrentV1(defaultImageDevelopStateV1(), { schemaVersion: 1, mode });
  const runtime = createPhotoDevelopRenderRuntimeCurrentV1(); let held: Readonly<PixelFrameV1> | undefined;
  await f.track(port.withDerivedFrame({ schemaVersion: 1, photoId: f.photo.id, expectedRevision: f.photo.revision, profile }, async view => {
   held = view.frame; assert.equal(view.profile, profile); assert.equal(view.frame.descriptor.sampleFormat, 'float32');
   assert.equal(view.frame.descriptor.width, f.photo.original.width); assert.equal(view.frame.descriptor.height, f.photo.original.height);
   assert.equal(prepareImageDevelopRawSourceCurrentV1(develop, view.frame).processVersion, 3);
   const source = hash(bytes(view.frame));
   for (const quality of ['full', 'proxy'] as const) {
    const consume = (result: Readonly<{ frame: Readonly<PixelFrameV1> }>) => { assert.equal(result.frame.descriptor.sampleFormat, 'float32'); assert.equal(hash(bytes(result.frame)), source); return quality; };
    const result = quality === 'full' ? await runtime.withFullResolution({ frame: view.frame, develop, signal: f.signal }, consume)
     : await runtime.withProxy({ frame: view.frame, develop, signal: f.signal }, consume);
    assert.equal(result, quality);
   }
  }));
  assert.ok(f.state.starts > 0); assert.equal(f.activeChildren(), 0); assert.equal(f.storage.events.filter(event => event === 'get-file').length, 0);
  assert.ok(held); assert.throws(() => prepareImageDevelopRawSourceCurrentV1(develop, held)); assert.ok(held.pixels.every(value => value === 0));
 });
});

void test('Complete Current native preview uses distinct recipe and real shared cache hit without pretending preview is full Original', { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  const recipes: string[] = [], descriptor = Object.getOwnPropertyDescriptor(Media.prototype, 'createBinaryDerivativeCache'); assert.ok(descriptor);
  const produce = Media.prototype.createBinaryDerivativeCache;
  const observe: typeof produce = function(this: Media, profile) {
   const cache = Reflect.apply(produce, this, [profile]) as ReturnType<typeof produce>;
   return Object.freeze<BinaryDerivativeCachePortV1>({ ...cache, store: (identity, body, sha, signal) => {
    recipes.push(normalizeBinaryDerivativeCacheIdentityV1(identity, profile).recipeId);
    return cache.store(identity, body, sha, signal);
   } });
  };
  Object.defineProperty(Media.prototype, 'createBinaryDerivativeCache', { ...descriptor, value: observe });
  try {
  const session = await f.openSession(), first = await session.readPreview(f.photo.id, 'thumbnail'); assert.equal(first.outcome, 'ready');
  if (first.outcome !== 'ready') assert.fail('Actual native preview did not publish.');
  assert.equal(first.cache, 'stored'); assert.deepEqual(recipes, ['lightscaper.native-original-preview.rgba8-nearest']);
  assert.equal(first.preview.descriptor.width, f.photo.original.width); assert.equal(first.preview.descriptor.height, f.photo.original.height);
  assert.equal(first.preview.byteLength, f.photo.original.width * f.photo.original.height * 4);
  const actual = new Uint8Array(await first.preview.body.arrayBuffer());
  try { assert.equal(hash(actual), first.preview.outputSha256); for (let index = 3; index < actual.length; index += 4) assert.equal(actual[index], 255); }
  finally { actual.fill(0); }
  const starts = f.state.starts; assert.ok(starts > 0);
  const hit = await session.readPreview(f.photo.id, 'thumbnail'); assert.equal(hit.outcome, 'ready'); if (hit.outcome === 'ready') assert.equal(hit.cache, 'hit');
  assert.equal(f.state.starts, starts); assert.equal(f.storage.events.filter(event => event === 'get-file').length, 0);
  assert.deepEqual(recipes, ['lightscaper.native-original-preview.rgba8-nearest']);
  } finally { Object.defineProperty(Media.prototype, 'createBinaryDerivativeCache', descriptor); }
 });
});
