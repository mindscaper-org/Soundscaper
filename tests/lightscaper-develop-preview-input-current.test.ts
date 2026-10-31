/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PhotoLibraryDevelopPresentationCurrentV1 as Presentation, preparePhotoDevelopPresentationViewCurrentV1 as prepare,
 type PhotoDevelopPresentationPortsCurrentV1 as Ports } from '../src/common/editor/controller/shared/photo-library-develop-presentation-current-v1.ts';
import { preparePhotoDevelopPresentationViewV2 as legacy } from '../src/common/editor/controller/shared/photo-library-develop-presentation-v2.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateThroughV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import type { PhotoLibraryPreviewOutcomeV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
const options = { concurrency: false, timeout: 15000 };
function fixture() {
 const pixels = Uint8Array.from({ length: 4 * 3 * 4 }, (_, i) => [16, 32, 48, 255][i % 4]!);
 const descriptor = { schemaVersion: 1 as const, width: 4, height: 3, sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const };
 const body = new Blob([pixels]), hash = createHash('sha256').update(pixels).digest('hex');
 const result: PhotoLibraryPreviewOutcomeV1 = { outcome: 'ready', cache: 'hit', notices: [], preview: { photoId: 'photo', tier: 'fit-screen', descriptor, byteLength: pixels.length, outputSha256: hash, body } };
 const before = {} as HTMLCanvasElement, after = {} as HTMLCanvasElement, painted = new Map<HTMLCanvasElement, Uint8Array>();
 const calls = { original: 0, preview: 0, proxy: 0, full: 0, revision: undefined as number | undefined };
 const actual = createPhotoDevelopRenderRuntimeCurrentV1();
 const ports: Ports = { async withOriginalFrame() { calls.original++; throw new Error('Disconnected Original'); },
  async readPreview(_id, _tier, request) { calls.preview++; calls.revision = Reflect.get(request, 'expectedRevision') as number | undefined; return result; },
  async loadProxy() { return { withProxy: (request, consume) => { calls.proxy++; return actual.withProxy(request, consume); },
   withFullResolution: (request, consume) => { calls.full++; return actual.withFullResolution(request, consume); } }; },
  paint(canvas, frame) { painted.set(canvas, new Uint8Array(frame.pixels)); return { width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength }; },
  clear(canvas) { painted.get(canvas)?.fill(0); painted.delete(canvas); } };
 const develop = normalizeImageDevelopStateThroughV4({ ...defaultImageDevelopStateV2(), processVersion: 3, repairs: { schemaVersion: 1, spots: [] } });
 const view = () => ({ photoId: 'photo', revision: 7, develop, before, after, resolution: 'proxy' as const, inputQuality: 'preview-derivative' as const });
 return { ports, calls, before, after, pixels, painted, result, view };
}
void test('Current explicit preview input renders authenticated cached bytes through the actual Develop runtime without opening Original', options, async () => {
 const f = fixture(), owner = new Presentation(f.ports);
 try { owner.setView(f.view()); await owner.drain(); assert.equal(owner.snapshot().status, 'ready');
  assert.deepEqual(f.calls, { original: 0, preview: 1, proxy: 1, full: 0, revision: 7 });
  assert.deepEqual(f.painted.get(f.before), f.pixels); assert.deepEqual(f.painted.get(f.after), f.pixels);
  assert.deepEqual(owner.snapshot().extent, { before: { width: 4, height: 3 }, after: { width: 4, height: 3 } });
 } finally { await owner.close(); f.pixels.fill(0); }
});
void test('Preview input is explicit, cannot request full resolution, and never widens the permanent legacy view', options, () => {
 const f = fixture(); try { const admitted = prepare(f.view()); assert.equal(Reflect.get(admitted, 'inputQuality'), 'preview-derivative');
  assert.throws(() => prepare({ ...f.view(), resolution: 'full' }), /preview.*full|full.*preview/iu);
  assert.throws(() => prepare({ ...f.view(), inputQuality: 'invented' })); assert.throws(() => legacy(f.view()));
 } finally { f.pixels.fill(0); }
});
for (const mode of ['headroom', 'recovery'] as const) void test(`Preview input refuses ${mode} source processing rather than minting RAW authority`, options, () => {
 const f = fixture(); try { assert.throws(() => prepare({ ...f.view(), develop: { ...f.view().develop, processVersion: 4,
  rawDevelopment: { schemaVersion: 1, mode } } }), /RAW|original/iu); } finally { f.pixels.fill(0); }
});
void test('Preview input authenticates its complete cached body before painting', options, async () => {
 const f = fixture(); assert.equal(f.result.outcome, 'ready'); const result = { ...f.result, preview: { ...f.result.preview, outputSha256: '0'.repeat(64) } };
 Object.assign(f.ports, { readPreview: async () => result });
 const owner = new Presentation(f.ports); try { owner.setView(f.view()); await owner.drain(); assert.equal(owner.snapshot().status, 'failed');
  assert.equal(f.painted.size, 0); assert.equal(f.calls.original, 0); assert.equal(f.calls.proxy, 0);
 } finally { await owner.close(); f.pixels.fill(0); }
});
void test('Closing preview input joins its accepted cache read before clearing and retiring presentation', options, async () => {
 const f = fixture(), entered = deferred<void>(), release = deferred<void>();
 Object.assign(f.ports, { readPreview: async () => { entered.resolve(); await release.promise; return f.result; } });
 const owner = new Presentation(f.ports), timer = setTimeout(() => { release.resolve(); void owner.close().catch(() => undefined); }, 5000);
 try { owner.setView(f.view()); await entered.promise; const closing = owner.close(); assert.equal(await remainsPending(closing), true);
  release.resolve(); await closing; assert.equal(f.painted.size, 0); assert.equal(f.calls.proxy, 0); assert.equal(f.calls.original, 0);
 } finally { clearTimeout(timer); release.resolve(); await owner.close(); f.pixels.fill(0); }
});
