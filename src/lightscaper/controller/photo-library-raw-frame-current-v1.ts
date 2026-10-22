/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1 } from '../../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { withRawRecoveryFrameAuthorityV1 } from '../../common/editor/raw/internal/raw-recovery-frame-authority-v1.ts';
import { readPhotoLibraryRawImportRequestCurrentV1, type PhotoLibraryRawImportSourceCurrentV1, type PhotoLibraryRawImportRequestCurrentV1, type PhotoLibraryRawImportFrameCurrentV1 } from './photo-library-raw-import-current-v1.ts';
import type { RawRecoveryPixelFrameV2 } from '../../common/editor/raw/libraw-wasm-instance-v2.ts';
import { readPhotoLibraryRawImportFrameCurrentV1 as readImport, readPhotoLibraryRawFrameCurrentV1 as readFrame, readPhotoLibraryRawPreviewCurrentV1 as readPreview,
 type PhotoLibraryRawSourceCurrentV1 as Source, type PhotoLibraryRawFrameRequestCurrentV1 as Request,
 type PhotoLibraryRawPreviewRequestCurrentV1 as PreviewRequest, type PhotoLibraryRawFrameCurrentV1 as Frame,
 type PhotoLibraryRawPreviewCurrentV1 as Preview, type PhotoLibraryRawResultCurrentV1 as Result } from './photo-library-raw-source-current-v1.ts';

const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!, SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** Trusted local native client composition only. A scalar frame/profile reader
 * grants no computational authority. This owner authenticates the complete
 * actual output and issues the existing fixed-profile lease only inside its
 * actual source callback; it expires before source-owned plane retirement. */
export async function withPhotoLibraryRawFrameCurrentV1<Value>(source: Readonly<Source>, request: Readonly<Request>,
 consume: (view: Readonly<Frame>) => Value | Promise<Value>, signal?: AbortSignal): Promise<Result<Value>> {
 const captured = captureRepairSignalV1(signal), method = source.withFrame;
 return scoped(request, consume, captured, view => readFrame(view, request), (accept) => Reflect.apply(method, source, [request, accept, { signal: captured }]) as Promise<unknown>, true);
}
export async function withPhotoLibraryRawPreviewCurrentV1<Value>(source: Readonly<Source>, request: Readonly<PreviewRequest>,
 consume: (view: Readonly<Preview>) => Value | Promise<Value>, signal?: AbortSignal): Promise<Result<Value>> {
 const captured = captureRepairSignalV1(signal), method = source.withPreview;
 return scoped(request, consume, captured, view => readPreview(view, request), (accept) => Reflect.apply(method, source, [request, accept, { signal: captured }]) as Promise<unknown>, false);
}
/** The same authenticated native plane lifetime, with a distinct genuine
 * prepublication input purpose and no stored Photo/Original descriptor. */
export async function withPhotoLibraryRawImportCurrentV1<Value>(source: Readonly<PhotoLibraryRawImportSourceCurrentV1>, value: Readonly<PhotoLibraryRawImportRequestCurrentV1>,
 consume: (view: Readonly<PhotoLibraryRawImportFrameCurrentV1>) => Value | Promise<Value>, signal?: AbortSignal): Promise<Result<Value>> {
 const captured = captureRepairSignalV1(signal), method = source.withFrame, request = readPhotoLibraryRawImportRequestCurrentV1(value);
 return scoped(request, consume, captured, view => readImport(view, { byteLength: request.body.size, contentSha256: request.contentSha256 }), accept => Reflect.apply(method, source, [request, accept, { signal: captured }]) as Promise<unknown>, false);
}
async function scoped<Value, View extends Readonly<Frame>>(request: Readonly<Request> | Readonly<PreviewRequest> | Readonly<PhotoLibraryRawImportRequestCurrentV1>, consume: (view: View) => Value | Promise<Value>,
 signal: AbortSignal | undefined, read: (value: unknown) => View, run: (accept: (view: unknown) => Promise<Value>) => Promise<unknown>, derived: boolean): Promise<Result<Value>> {
 checkRepairSignalV1(signal); if (typeof consume !== 'function') throw new TypeError('Native RAW requires its actual local frame consumer.');
 let entered = false, finished = false, value!: Value;
 const result = await run(async borrowed => {
  if (entered) throw new Error('Native RAW source delivered more than one plane.'); entered = true;
  checkRepairSignalV1(signal); const view = read(borrowed); await authenticate(view, signal);
  const accept = async (): Promise<Value> => { const result = await consume(view); await authenticate(view, signal); return result; };
  value = derived && view.profile !== 'canonical'
   ? await withRawRecoveryFrameAuthorityV1({ frame: view.frame as RawRecoveryPixelFrameV2, rawFlip: view.rawFlip,
    profile: view.profile, exposureScale: view.exposureScale }, accept)
   : await accept(); finished = true; return value;
 });
 checkRepairSignalV1(signal);
 const input = record(result, 'native RAW scoped result', ['outcome', 'value', 'reason'], ['outcome']);
 if (field(input, 'outcome', 'native RAW scoped result') === 'native') {
  record(result, 'native RAW completed result', ['outcome', 'value']);
  if (!entered || !finished || !Object.is(field(input, 'value', 'native RAW completed result'), value)) throw new TypeError('Native RAW source has no matching completed local consumer.');
  return Object.freeze({ outcome: 'native', value });
 }
 record(result, 'native RAW fallback result', ['outcome', 'reason']);
 const reason = field(input, 'reason', 'native RAW fallback result');
 if (entered || field(input, 'outcome', 'native RAW fallback result') !== 'web-fallback' || reason !== 'native-unavailable' && reason !== 'unsupported-representation') throw new TypeError('Native RAW source cannot substitute a fallback after entering its consumer.');
 // request keeps the exact admitted Original alive until the owning method's
 // terminal receipt; a fallback license never contains pixel/body authority.
 void request; return Object.freeze({ outcome: 'web-fallback', reason });
}
async function authenticate(view: Readonly<Frame>, signal: AbortSignal | undefined): Promise<void> {
 const pixels = view.frame.pixels, expected = view.frame.descriptor.width * view.frame.descriptor.height * 4;
 const length = expected * (view.frame.descriptor.sampleFormat === 'float32' ? 4 : view.frame.descriptor.sampleFormat === 'unorm16' ? 2 : 1);
 const backing = Reflect.apply(BUFFER, pixels, []) as ArrayBuffer;
 const check = () => {
  checkRepairSignalV1(signal);
  for (const key of ['buffer', 'length', 'byteLength', 'byteOffset']) if (Object.hasOwn(pixels, key)) throw new TypeError('Native RAW plane acquired shadowed geometry.');
  if (Reflect.apply(SIZE, backing, []) !== length || Reflect.apply(LENGTH, pixels, []) !== length || Reflect.apply(OFFSET, pixels, []) !== 0) throw new RangeError('Native RAW physical plane detached or changed during its borrow.');
 }; check(); const budget = new RepairTaskBudgetV1(check);
 const bytes = new Uint8Array(backing), hash = sha256.create();
 const alpha = view.frame.descriptor.sampleFormat === 'float32' ? 1 : view.frame.descriptor.sampleFormat === 'unorm16' ? 65535 : 255;
 for (let index = 0; index < expected; index++) {
  const sample = pixels[index]!;
  if (!Number.isFinite(sample) || index % 4 === 3 && sample !== alpha) throw new RangeError('Actual native RAW plane is nonfinite or nonopaque.');
  if (budget.visit()) await budget.yield();
 }
 for (let offset = 0; offset < bytes.byteLength; offset += 1024 * 1024) {
  check(); hash.update(bytes.subarray(offset, Math.min(bytes.byteLength, offset + 1024 * 1024)));
  await budget.yield();
 }
 check(); if (bytesToHex(hash.digest()) !== view.contentSha256) throw new RangeError('Actual native RAW output bytes differ from their complete delivery SHA.');
}
