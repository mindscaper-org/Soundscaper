/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { rawDngFixtureV1, rawDngSensorSample } from './helpers/lightscaper-raw-dng-current-fixture.ts';
import { rawRecoveryDngFixtureV1, RAW_RECOVERY_ROIS, type RawRecoveryOrientationV1 } from './helpers/lightscaper-raw-recovery-dng-current-fixture.ts';
import { nativeRawEngineFixtureCurrentV1 as fixture, nativeRawNeutralOracleCurrentV1 as neutral,
 nativeRawRecoveryOracleCurrentV1 as recovery, nativeRawEmbeddedOracleCurrentV1 as embedded,
 nativeRawHashCurrentV1 as hash, type NativeRawResultCurrentV1 } from './helpers/lightscaper-native-raw-engine-fixture-current.ts';
import { withLinearPixelFrameDisplayV1 } from '../src/common/editor/imaging/pixel-frame-linear-display-v1.ts';
import { planPhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { preparePhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-preparation-v1.ts';
import camera from '../config/lightscaper-raw-fixtures.json' with { type: 'json' };

const PROFILES = [['linear-headroom', 'linear-headroom-v1'], ['highlight-recovery', 'highlight-recovery-v1']] as const;
function serialWords(words: Uint16Array): Uint8Array<ArrayBuffer> {
 const bytes = new Uint8Array(words.length * 2), view = new DataView(bytes.buffer);
 for (let at = 0; at < words.length; at++) view.setUint16(at * 2, words[at]!, true); return bytes;
}
function checkNeutral(value: NativeRawResultCurrentV1, oracle: Awaited<ReturnType<typeof neutral>>): void {
 assert.equal(value.format, 'rgba16le'); assert.equal(value.recipe, null); assert.equal(value.channels, 4); assert.equal(value.bits, 16);
 assert.equal(value.width, oracle.frame.descriptor.width); assert.equal(value.height, oracle.frame.descriptor.height); assert.equal(value.rawFlip, oracle.rawFlip);
 const expected = serialWords(oracle.frame.pixels); try { assert.equal(hash(value.bytes), hash(expected)); } finally { expected.fill(0); }
}
function checkRecovery(value: NativeRawResultCurrentV1, oracle: Awaited<ReturnType<typeof recovery>>): void {
 assert.equal(value.format, 'rgba32fle'); assert.equal(value.channels, 4); assert.equal(value.bits, 32);
 assert.equal(value.width, oracle.frame.descriptor.width); assert.equal(value.height, oracle.frame.descriptor.height); assert.equal(value.rawFlip, oracle.rawFlip);
 assert.equal(value.byteLength, oracle.frame.pixels.length * 4); assert.ok(Math.abs(value.exposureScale - oracle.exposureScale) <= 1e-12);
 const view = new DataView(value.bytes.buffer); let maximumNormalizedError = 0;
 for (let at = 0; at < oracle.frame.pixels.length; at++) {
  const sample = view.getFloat32(at * 4, true), expected = oracle.frame.pixels[at]!; assert.ok(Number.isFinite(sample));
  if (at % 4 === 3) assert.equal(sample, 1);
  maximumNormalizedError = Math.max(maximumNormalizedError, Math.abs(sample - expected) / Math.max(1, Math.abs(expected)));
 }
 assert.ok(maximumNormalizedError <= 2e-6, `Native Float32 profile exceeds declared2e-6 tolerance: ${maximumNormalizedError}.`);
}
function mean(value: NativeRawResultCurrentV1, roi: Readonly<{ x: number; y: number; width: number; height: number }>, channel: number): number {
 const samples = new DataView(value.bytes.buffer); let total = 0;
 for (let y = roi.y; y < roi.y + roi.height; y++) for (let x = roi.x; x < roi.x + roi.width; x++) total += samples.getFloat32(((y * value.width + x) * 4 + channel) * 4, true);
 return total / (roi.width * roi.height);
}
function replaceTiffScalar(bytes: Uint8Array<ArrayBuffer>, tag: number, value: number): void {
 const view = new DataView(bytes.buffer), count = view.getUint16(8, true);
 for (let index = 0; index < count; index++) { const at = 10 + index * 12; if (view.getUint16(at, true) === tag) { assert.equal(view.getUint32(at + 4, true), 1); view.setUint32(at + 8, value, true); return; } }
 throw new Error('Owned TIFF field is missing.');
}
/** Bounded0.44MP owned sensor for one real512px downsampling witness. Header
 * values and repeated RGGB literals are independent of either decoder. */
function previewDng(): Uint8Array<ArrayBuffer> {
 const old = rawDngFixtureV1(), width = 768, height = 576, bytes = new Uint8Array(old.rawOffset + width * height * 2);
 bytes.set(old.bytes.subarray(0, old.rawOffset)); old.bytes.fill(0); old.sensor.fill(0);
 for (const [tag, value] of [[256, width], [257, height], [278, height], [279, width * height * 2]]) replaceTiffScalar(bytes, tag!, value!);
 const view = new DataView(bytes.buffer), count = view.getUint16(8, true);
 for (let index = 0; index < count; index++) { const at = 10 + index * 12, tag = view.getUint16(at, true), offset = view.getUint32(at + 8, true);
  if (tag === 50720) { view.setUint32(offset, width, true); view.setUint32(offset + 4, height, true); }
  if (tag === 50829) { view.setUint32(offset + 8, height, true); view.setUint32(offset + 12, width, true); }
 }
 for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) view.setUint16(old.rawOffset + (y * width + x) * 2, rawDngSensorSample(x % 32, y % 32), true);
 return bytes;
}

void test('Actual target-native LibRaw neutral words match the pinned independent WASM plane and retain sub-byte precision', { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  const source = rawDngFixtureV1(), before = hash(source.bytes), oracle = await neutral(source.bytes), actual = await f.execute('neutral', source.bytes);
  try { checkNeutral(actual, oracle); const values = new DataView(actual.bytes.buffer); let deeperThanByte = false;
   for (let at = 0; at < actual.bytes.length; at += 8) { assert.equal(values.getUint16(at + 6, true), 65535); if (values.getUint16(at, true) % 257 !== 0) deeperThanByte = true; }
   assert.ok(deeperThanByte); assert.equal(hash(source.bytes), before);
  } finally { actual.bytes.fill(0); oracle.frame.pixels.fill(0); source.bytes.fill(0); source.sensor.fill(0); }
 });
});
void test('Actual target-native neutral decode preserves all eight rectangular orientations', { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
   context.signal.throwIfAborted(); const source = rawRecoveryDngFixtureV1({ orientation }), oracle = await neutral(source.bytes), actual = await f.execute('neutral', source.bytes);
   try { checkNeutral(actual, oracle); assert.equal(actual.width, orientation >= 5 ? source.height : source.width); assert.equal(actual.height, orientation >= 5 ? source.width : source.height); }
   finally { actual.bytes.fill(0); oracle.frame.pixels.fill(0); source.bytes.fill(0); source.sensor.fill(0); }
  }
 });
});
for (const [mode, profile] of PROFILES) void test(`Actual target-native ${profile} matches independent signed Float32/orientation/exposure facts`, { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  for (const orientation of [1, 6] as const) {
   context.signal.throwIfAborted(); const source = rawRecoveryDngFixtureV1({ orientation }), oracle = await recovery(source.bytes, profile), actual = await f.execute(mode, source.bytes);
   try { checkRecovery(actual, oracle); assert.ok(actual.exposureScale > 1.5 && actual.exposureScale < 2.5); }
   finally { actual.bytes.fill(0); oracle.frame.pixels.fill(0); source.bytes.fill(0); source.sensor.fill(0); }
  }
 });
});
void test('Actual H3 retains midtones/reference information and recovers ordered clipped-channel detail', { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  const source = rawRecoveryDngFixtureV1(), h1 = await f.execute('linear-headroom', source.bytes), h3 = await f.execute('highlight-recovery', source.bytes);
  try { assert.equal(h1.exposureScale, h3.exposureScale);
   for (const channel of [0, 1, 2]) assert.ok(Math.abs(mean(h3, RAW_RECOVERY_ROIS.midtone, channel) - mean(h1, RAW_RECOVERY_ROIS.midtone, channel)) < 1e-6);
   for (const channel of [1, 2]) { const detail = RAW_RECOVERY_ROIS.highlights.map(roi => mean(h3, roi, channel)); assert.ok(detail[3]! - detail[0]! > .4);
    for (let index = 1; index < detail.length; index++) assert.ok(detail[index]! - detail[index - 1]! > .1);
    for (const roi of RAW_RECOVERY_ROIS.highlights) assert.ok(Math.abs(mean(h3, roi, 0) - mean(h1, roi, 0)) < .001);
   }
  } finally { h1.bytes.fill(0); h3.bytes.fill(0); source.bytes.fill(0); source.sensor.fill(0); }
 });
});
void test('Actual derived native engine preserves signed color and values above display white', { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  const source = rawRecoveryDngFixtureV1({ variant: 'color-canary' }), oracle = await recovery(source.bytes, 'linear-headroom-v1'), actual = await f.execute('linear-headroom', source.bytes);
  try { checkRecovery(actual, oracle); const view = new DataView(actual.bytes.buffer); let minimum = Infinity, maximum = -Infinity;
   for (let at = 0; at < actual.byteLength; at += 4) { const sample = view.getFloat32(at, true); minimum = Math.min(minimum, sample); maximum = Math.max(maximum, sample); }
   assert.ok(minimum < -.01); assert.ok(maximum > 1.01);
  } finally { actual.bytes.fill(0); oracle.frame.pixels.fill(0); source.bytes.fill(0); source.sensor.fill(0); }
 });
});
void test('Genuine owned DNG has no embedded preview and native extraction does not manufacture a decode', { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  const source = rawDngFixtureV1(), actual = await f.execute('embedded', source.bytes);
  try { assert.equal(await embedded(source.bytes), null); assert.equal(actual.format, 'none'); assert.equal(actual.byteLength, 0); assert.equal(actual.width, 0); assert.equal(actual.height, 0); }
  finally { actual.bytes.fill(0); source.bytes.fill(0); source.sensor.fill(0); }
 });
});
void test('Native embedded extraction uses the actual pinned CC0 camera body and exact independent JPEG bytes', { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  const pin = camera.fixtures[0]!; const source = new Uint8Array(await readFile(new URL(`../vendor/lightscaper-raw-fixtures/${pin.fileName}`, import.meta.url)));
  assert.equal(source.byteLength, pin.byteLength); assert.equal(hash(source), pin.sha256);
  const oracle = await embedded(source); assert.ok(oracle); const actual = await f.execute('embedded', source);
  try { assert.equal(oracle.type, 'jpeg'); assert.equal(actual.format, 'jpeg'); assert.equal(actual.width, oracle.width); assert.equal(actual.height, oracle.height); assert.equal(actual.rawFlip, oracle.rawFlip);
   assert.equal(actual.channels, oracle.channels); assert.equal(actual.bits, oracle.bits); assert.equal(actual.byteLength, oracle.bytes.byteLength); assert.equal(hash(actual.bytes), hash(oracle.bytes));
  } finally { actual.bytes.fill(0); oracle.bytes.fill(0); source.fill(0); }
 });
});
for (const tier of ['thumbnail', 'fit-screen'] as const) void test(`Actual native neutral ${tier} preview proves its declared nearest/transfer bytes independently`, { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  const source = tier === 'thumbnail' ? previewDng() : rawDngFixtureV1(6).bytes, oracle = await neutral(source), actual = await f.execute('preview-neutral', source, tier);
  try {
   const binding = { catalogId: 'native-oracle', photoId: 'actual-raw', originalId: 'original', storageKey: 'original', contentSha256: hash(source), byteLength: source.byteLength,
    width: oracle.frame.descriptor.width, height: oracle.frame.descriptor.height };
   const expected = await withLinearPixelFrameDisplayV1({ frame: oracle.frame, signal: context.signal }, async frame => {
    const plan = planPhotoPreviewV1({ binding, source: frame.descriptor, tier }); return preparePhotoPreviewV1({ plan, binding, frame, signal: context.signal });
   }, 'full');
   assert.equal(actual.recipe, 'lightscaper.native-original-preview.rgba8-nearest/v1'); assert.equal(actual.format, 'rgba8'); assert.equal(actual.bits, 8); assert.equal(actual.channels, 4);
   assert.equal(actual.width, expected.descriptor.width); assert.equal(actual.height, expected.descriptor.height); assert.equal(hash(actual.bytes), expected.outputSha256);
   if (tier === 'thumbnail') assert.equal(actual.width, 512); else assert.equal(actual.width, 32);
  } finally { actual.bytes.fill(0); oracle.frame.pixels.fill(0); source.fill(0); }
 });
});
for (const [mode, profile] of [['preview-headroom', 'linear-headroom-v1'], ['preview-recovery', 'highlight-recovery-v1']] as const) void test(`Native ${mode} is a disposable real-derived presentation with a distinct recipe`, { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  const source = rawRecoveryDngFixtureV1(), oracle = await recovery(source.bytes, profile), actual = await f.execute(mode, source.bytes, 'thumbnail');
  try { await withLinearPixelFrameDisplayV1({ frame: oracle.frame, signal: context.signal }, expected => {
   assert.equal(actual.format, 'rgba8'); assert.equal(actual.width, expected.descriptor.width); assert.equal(actual.height, expected.descriptor.height); assert.equal(hash(actual.bytes), hash(new Uint8Array(expected.pixels.buffer)));
  }, 'full'); }
  finally { actual.bytes.fill(0); oracle.frame.pixels.fill(0); source.bytes.fill(0); source.sensor.fill(0); }
 });
});
void test('Actual native engine refuses empty, corrupt, truncated and over-side source declarations', { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  await f.refuse(new Uint8Array()); await f.refuse(Uint8Array.of(1, 2, 3, 4));
  const source = rawDngFixtureV1(); try { await f.refuse(new Uint8Array(source.bytes.subarray(0, 32))); replaceTiffScalar(source.bytes, 256, 8193); await f.refuse(source.bytes); }
  finally { source.bytes.fill(0); source.sensor.fill(0); }
 });
});
void test('Independent native jobs do not retain a prior format/profile or mutate later input', { timeout: 15_000 }, async context => {
 await fixture(context, async f => {
  const source = rawRecoveryDngFixtureV1({ orientation: 8 as RawRecoveryOrientationV1 }), before = hash(source.bytes);
  const first = await f.execute('neutral', source.bytes), derived = await f.execute('linear-headroom', source.bytes), second = await f.execute('neutral', source.bytes);
  try { assert.equal(hash(first.bytes), hash(second.bytes)); assert.notEqual(hash(first.bytes), hash(derived.bytes)); assert.equal(hash(source.bytes), before); }
  finally { first.bytes.fill(0); derived.bytes.fill(0); second.bytes.fill(0); source.bytes.fill(0); source.sensor.fill(0); }
 });
});
