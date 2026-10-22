/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scopePhotoCurrentV1 } from './helpers/lightscaper-native-library-scope-integration-fixture-current.ts';
import { normalizePhotoOriginalV1 } from '../src/lightscaper/catalog/photo-document-envelope-v1.ts';
import { capturePhotoLibraryRawSourceCurrentV1, readPhotoLibraryRawFrameRequestCurrentV1,
 readPhotoLibraryRawPreviewRequestCurrentV1, readPhotoLibraryRawFrameCurrentV1,
 readPhotoLibraryRawPreviewCurrentV1 } from '../src/lightscaper/controller/photo-library-raw-source-current-v1.ts';

const PROFILE = Object.freeze({ schemaVersion: 1, engine: 'lightscaper-libraw-native', engineVersion: 1, upstream: '0.22.2',
 profile: 'neutral-linear-srgb16', profileVersion: 1 });
function original() {
 const fixture = scopePhotoCurrentV1();
 try { return normalizePhotoOriginalV1({ ...fixture.photo.original, name: 'Actual RAW.dng', mimeType: 'image/x-adobe-dng',
  width: 32, height: 32, hasAlpha: false, byteLength: 2700, contentSha256: 'a'.repeat(64) }); }
 finally { fixture.bytes.fill(0); }
}
function previewRequest() { return { catalogId: 'catalog', photoId: 'photo', original: original(), expectedRevision: null, tier: 'thumbnail' }; }
function request(profile = 'canonical') { return { catalogId: 'catalog', photoId: 'photo', original: original(), expectedRevision: 7, profile }; }
function frame(profile: 'canonical' | 'linear-headroom-v1' | 'highlight-recovery-v1' = 'canonical') {
 const pixels = profile === 'canonical' ? new Uint16Array(32 * 32 * 4) : new Float32Array(32 * 32 * 4);
 for (let index = 3; index < pixels.length; index += 4) pixels[index] = profile === 'canonical' ? 65535 : 1;
 return { decoder: { ...PROFILE, profile: profile === 'canonical' ? 'neutral-linear-srgb16' : profile === 'linear-headroom-v1' ? 'linear-headroom-f32' : 'highlight-recovery-f32' },
  profile, frame: { descriptor: { schemaVersion: 1, width: 32, height: 32, sampleFormat: profile === 'canonical' ? 'unorm16' : 'float32', primaries: 'srgb', transfer: 'linear' }, pixels },
  rawFlip: 0, exposureScale: 1, contentSha256: 'b'.repeat(64) };
}

void test('Native RAW source requests retain the complete immutable Original and explicit selected revision', () => {
 const input = request(), admitted = readPhotoLibraryRawFrameRequestCurrentV1(input);
 assert.deepEqual(admitted.original, input.original); assert.equal(admitted.expectedRevision, 7); assert.equal(admitted.profile, 'canonical');
 assert.ok(Object.isFrozen(admitted)); assert.ok(Object.isFrozen(admitted.original)); assert.notEqual(admitted.original, input.original);
 assert.equal(readPhotoLibraryRawFrameRequestCurrentV1({ ...input, expectedRevision: null }).expectedRevision, null);
 for (const expectedRevision of [-1, -0, 1.5, NaN, undefined]) assert.throws(() => readPhotoLibraryRawFrameRequestCurrentV1({ ...input, expectedRevision }));
 assert.throws(() => readPhotoLibraryRawFrameRequestCurrentV1({ ...input, original: { ...input.original, contentSha256: 'A'.repeat(64) } }));
 assert.throws(() => readPhotoLibraryRawFrameRequestCurrentV1({ ...input, path: '/untrusted' }));
});

void test('Native preview request is a separate tier request and permits attribute revisions only through null', () => {
 const input = previewRequest();
 const admitted = readPhotoLibraryRawPreviewRequestCurrentV1({ ...input, expectedRevision: null, tier: 'thumbnail' });
 assert.equal(admitted.tier, 'thumbnail'); assert.equal(admitted.expectedRevision, null);
 assert.throws(() => readPhotoLibraryRawPreviewRequestCurrentV1({ ...input, expectedRevision: 7 }));
 assert.throws(() => readPhotoLibraryRawPreviewRequestCurrentV1({ ...input, expectedRevision: null, tier: 'full' }));
 assert.throws(() => readPhotoLibraryRawPreviewRequestCurrentV1({ ...input, expectedRevision: null, tier: 'thumbnail', profile: 'canonical' }));
});

void test('Native RAW closed capture refuses accessor fields without invoking them and preserves an opaque reflection throw', () => {
 let reflected = 0; const input = request(), reason = Symbol('actual request trap');
 assert.throws(() => readPhotoLibraryRawFrameRequestCurrentV1(Object.defineProperty({ ...input }, 'profile', { get() { reflected++; return 'canonical'; } })));
 assert.equal(reflected, 0);
 assert.throws(() => readPhotoLibraryRawFrameRequestCurrentV1(new Proxy(input, { ownKeys() { throw reason; } })), value => value === reason);
});

for (const profile of ['canonical', 'linear-headroom-v1', 'highlight-recovery-v1'] as const) {
 void test(`Native RAW ${profile} view retains an explicit native decoder identity and exact full plane`, () => {
  const input = frame(profile);
  try {
   const admitted = readPhotoLibraryRawFrameCurrentV1(input, readPhotoLibraryRawFrameRequestCurrentV1(request(profile)));
   assert.equal(admitted.frame.pixels, input.frame.pixels); assert.deepEqual(admitted.decoder, input.decoder);
   assert.equal(admitted.frame.descriptor.width, 32); assert.equal(admitted.frame.descriptor.height, 32);
   assert.equal(admitted.contentSha256, 'b'.repeat(64)); assert.ok(Object.isFrozen(admitted));
   assert.throws(() => readPhotoLibraryRawFrameCurrentV1({ ...input, decoder: { ...input.decoder, engine: 'libraw-wasm' } }, readPhotoLibraryRawFrameRequestCurrentV1(request(profile))));
   assert.throws(() => readPhotoLibraryRawFrameCurrentV1({ ...input, decoder: { ...input.decoder, profileVersion: 2 } }, readPhotoLibraryRawFrameRequestCurrentV1(request(profile))));
   assert.throws(() => readPhotoLibraryRawFrameCurrentV1({ ...input, frame: { ...input.frame, descriptor: { ...input.frame.descriptor, width: 16 } } }, readPhotoLibraryRawFrameRequestCurrentV1(request(profile))));
  } finally { input.frame.pixels.fill(0); }
 });
}

void test('Native RAW frame admission refuses shared, offset and detached backing before any pixel interpretation', () => {
 const input = frame(), admitted = readPhotoLibraryRawFrameRequestCurrentV1(request());
 const offset = new Uint16Array(new ArrayBuffer(input.frame.pixels.byteLength + 2), 2), shared = new Uint16Array(new SharedArrayBuffer(input.frame.pixels.byteLength));
 const detached = new Uint16Array(input.frame.pixels.length); structuredClone(detached.buffer, { transfer: [detached.buffer] });
 try {
  for (const pixels of [offset, shared, detached]) assert.throws(() => readPhotoLibraryRawFrameCurrentV1({ ...input, frame: { ...input.frame, pixels } }, admitted));
  assert.throws(() => readPhotoLibraryRawFrameCurrentV1({ ...input, frame: { ...input.frame, pixels: new Uint8Array(input.frame.pixels.byteLength) } }, admitted));
 } finally { input.frame.pixels.fill(0); offset.fill(0); shared.fill(0); }
});

void test('Native RAW output requires matching mode, bounded orientation and applied normalization', () => {
 const input = frame();
 try {
  const admitted = readPhotoLibraryRawFrameRequestCurrentV1(request());
  for (const rawFlip of [-1, 8, 1.5]) assert.throws(() => readPhotoLibraryRawFrameCurrentV1({ ...input, rawFlip }, admitted));
  for (const exposureScale of [0, 2, Infinity]) assert.throws(() => readPhotoLibraryRawFrameCurrentV1({ ...input, exposureScale }, admitted));
  assert.throws(() => readPhotoLibraryRawFrameCurrentV1({ ...input, profile: 'highlight-recovery-v1' }, admitted));
  assert.throws(() => readPhotoLibraryRawFrameCurrentV1({ ...input, contentSha256: 'not-a-sha' }, admitted));
 } finally { input.frame.pixels.fill(0); }
});

void test('Native preview profile cannot masquerade as a full Original plane or permanent Web cache recipe', () => {
 const requested = readPhotoLibraryRawPreviewRequestCurrentV1(previewRequest());
 const pixels = new Uint8Array(32 * 32 * 4), view = { decoder: PROFILE, profile: 'canonical',
  frame: { descriptor: { schemaVersion: 1, width: 32, height: 32, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels },
  rawFlip: 0, exposureScale: 1, contentSha256: 'c'.repeat(64), source: { width: 32, height: 32 },
  recipe: { id: 'lightscaper.native-original-preview.rgba8-nearest', version: 1 } };
 for (let index = 3; index < pixels.length; index += 4) pixels[index] = 255;
 try {
  const admitted = readPhotoLibraryRawPreviewCurrentV1(view, requested); assert.equal(admitted.frame.pixels, pixels); assert.equal(admitted.recipe.id, view.recipe.id);
  assert.throws(() => readPhotoLibraryRawPreviewCurrentV1({ ...view, recipe: { ...view.recipe, id: 'lightscaper.original-preview.rgba8-nearest' } }, requested));
  assert.throws(() => readPhotoLibraryRawPreviewCurrentV1({ ...view, source: { width: 31, height: 32 } }, requested));
  assert.throws(() => readPhotoLibraryRawFrameCurrentV1(view, readPhotoLibraryRawFrameRequestCurrentV1(request())));
 } finally { pixels.fill(0); }
});

void test('Optional RAW capability capture accepts actual prototype methods and retains their receiver once', async () => {
 let calls = 0;
 class Source {
  readonly marker = 'actual local capability';
  withFrame() { assert.equal(this.marker, 'actual local capability'); calls++; return Promise.resolve(Object.freeze({ outcome: 'web-fallback' as const, reason: 'native-unavailable' as const })); }
  withPreview() { assert.equal(this.marker, 'actual local capability'); calls++; return Promise.resolve(Object.freeze({ outcome: 'web-fallback' as const, reason: 'native-unavailable' as const })); }
 }
 const source = new Source(), captured = capturePhotoLibraryRawSourceCurrentV1(source), old = Source.prototype.withFrame; assert.ok(captured);
 try {
  Source.prototype.withFrame = () => { assert.fail('Late method replacement must not retarget captured RAW owner.'); };
  const result = await captured.withFrame(readPhotoLibraryRawFrameRequestCurrentV1(request()), () => assert.fail('Fallback must enter no native plane consumer.'));
  assert.equal(result.outcome, 'web-fallback'); assert.equal(calls, 1);
 } finally { Source.prototype.withFrame = old; }
 assert.equal(capturePhotoLibraryRawSourceCurrentV1(undefined), undefined);
 assert.throws(() => capturePhotoLibraryRawSourceCurrentV1({ withFrame: () => undefined }));
});
