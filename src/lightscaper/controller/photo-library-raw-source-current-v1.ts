/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/foundation/closed-domain-value.ts';
import { readPixelFrameDescriptorV1, readPixelFrameV1, type PixelFrameV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { fitPixelSizeV1 } from '../../common/editor/imaging/pixel-frame-resize-v1.ts';
import { normalizePhotoOriginalV1 } from '../catalog/photo-document-envelope-v1.ts';
import type { PhotoLibraryRawImportFrameCurrentV1 } from './photo-library-raw-import-current-v1.ts';
import type { PhotoOriginalV1 } from '../catalog/types.ts';
import { id } from '../catalog/value-validation.ts';
export type PhotoLibraryRawProfileCurrentV1 = 'canonical' | 'linear-headroom-v1' | 'highlight-recovery-v1';
export interface PhotoLibraryRawFrameRequestCurrentV1 {
 readonly catalogId: string; readonly photoId: string; readonly original: Readonly<PhotoOriginalV1>;
 readonly expectedRevision: number | null; readonly profile: PhotoLibraryRawProfileCurrentV1;
}
export interface PhotoLibraryRawPreviewRequestCurrentV1 extends Omit<PhotoLibraryRawFrameRequestCurrentV1, 'profile' | 'expectedRevision'> {
 readonly expectedRevision: null; readonly tier: 'thumbnail' | 'fit-screen';
}
export interface PhotoLibraryRawDecoderCurrentV1 {
 readonly schemaVersion: 1; readonly engine: 'lightscaper-libraw-native'; readonly engineVersion: 1; readonly upstream: '0.22.2';
 readonly profile: 'neutral-linear-srgb16' | 'linear-headroom-f32' | 'highlight-recovery-f32'; readonly profileVersion: 1;
}
export interface PhotoLibraryRawFrameCurrentV1 {
 readonly decoder: Readonly<PhotoLibraryRawDecoderCurrentV1>; readonly profile: PhotoLibraryRawProfileCurrentV1;
 readonly frame: Readonly<PixelFrameV1>; readonly rawFlip: number; readonly exposureScale: number; readonly contentSha256: string;
}
export interface PhotoLibraryRawPreviewCurrentV1 extends PhotoLibraryRawFrameCurrentV1 {
 readonly profile: 'canonical'; readonly source: Readonly<{ width: number; height: number }>;
 readonly recipe: Readonly<{ id: 'lightscaper.native-original-preview.rgba8-nearest'; version: 1 }>;
}
export type PhotoLibraryRawResultCurrentV1<Result> = Readonly<{ outcome: 'native'; value: Result }>
 | Readonly<{ outcome: 'web-fallback'; reason: 'native-unavailable' | 'unsupported-representation' }>;
type Options = Readonly<{ signal?: AbortSignal }>;
export interface PhotoLibraryRawSourceCurrentV1 {
 withFrame<Result>(request: Readonly<PhotoLibraryRawFrameRequestCurrentV1>, consume: (view: Readonly<PhotoLibraryRawFrameCurrentV1>) => Result | Promise<Result>, options?: Options): Promise<PhotoLibraryRawResultCurrentV1<Result>>;
 withPreview<Result>(request: Readonly<PhotoLibraryRawPreviewRequestCurrentV1>, consume: (view: Readonly<PhotoLibraryRawPreviewCurrentV1>) => Result | Promise<Result>, options?: Options): Promise<PhotoLibraryRawResultCurrentV1<Result>>;
}
const FRAME_FIELDS = ['decoder', 'profile', 'frame', 'rawFlip', 'exposureScale', 'contentSha256'];
const DECODER_FIELDS = ['schemaVersion', 'engine', 'engineVersion', 'upstream', 'profile', 'profileVersion'];
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!, RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const LIMITS = Object.freeze({ maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 256 * 1024 * 1024 });

export function readPhotoLibraryRawFrameRequestCurrentV1(value: unknown): Readonly<PhotoLibraryRawFrameRequestCurrentV1> {
 const input = record(value, 'native RAW frame request', ['catalogId', 'photoId', 'original', 'expectedRevision', 'profile']);
 const profile = field(input, 'profile', 'native RAW frame request');
 if (profile !== 'canonical' && profile !== 'linear-headroom-v1' && profile !== 'highlight-recovery-v1') throw new RangeError('Unsupported native RAW fixed profile.');
 return Object.freeze({ ...request(input), expectedRevision: revision(field(input, 'expectedRevision', 'native RAW frame request')), profile });
}
export function readPhotoLibraryRawPreviewRequestCurrentV1(value: unknown): Readonly<PhotoLibraryRawPreviewRequestCurrentV1> {
 const input = record(value, 'native RAW preview request', ['catalogId', 'photoId', 'original', 'expectedRevision', 'tier']);
 const tier = field(input, 'tier', 'native RAW preview request');
 if (field(input, 'expectedRevision', 'native RAW preview request') !== null || tier !== 'thumbnail' && tier !== 'fit-screen') throw new RangeError('Native preview requires a tier and attribute-independent Original authority.');
 return Object.freeze({ ...request(input), expectedRevision: null, tier });
}
function request(input: Readonly<Record<string, unknown>>) {
 return { catalogId: id(field(input, 'catalogId', 'native RAW request'), 'native RAW catalog'), photoId: id(field(input, 'photoId', 'native RAW request'), 'native RAW photo'),
  original: normalizePhotoOriginalV1(field(input, 'original', 'native RAW request')) };
}
function revision(value: unknown): number | null {
 if (value === null) return null;
 if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw new RangeError('Native RAW requires an exact revision or explicit null.'); return value;
}
function decoder(value: unknown, profile: PhotoLibraryRawProfileCurrentV1): Readonly<PhotoLibraryRawDecoderCurrentV1> {
 const input = record(value, 'native RAW decoder identity', DECODER_FIELDS);
 const native = profile === 'canonical' ? 'neutral-linear-srgb16' : profile === 'linear-headroom-v1' ? 'linear-headroom-f32' : 'highlight-recovery-f32';
 for (const [key, expected] of Object.entries({ schemaVersion: 1, engine: 'lightscaper-libraw-native', engineVersion: 1, upstream: '0.22.2', profile: native, profileVersion: 1 })) {
  if (field(input, key, 'native RAW decoder identity') !== expected) throw new RangeError('Native RAW decoder profile is not the selected maintained identity.');
 }
 return Object.freeze({ schemaVersion: 1, engine: 'lightscaper-libraw-native', engineVersion: 1, upstream: '0.22.2', profile: native, profileVersion: 1 });
}
function physical(value: unknown, sampleFormat: 'unorm16' | 'float32' | 'unorm8', width: number, height: number): Readonly<PixelFrameV1> {
 const input = record(value, 'native RAW physical frame', ['descriptor', 'pixels']);
 const descriptor = readPixelFrameDescriptorV1(field(input, 'descriptor', 'native RAW physical frame'));
 if (descriptor.width !== width || descriptor.height !== height || descriptor.sampleFormat !== sampleFormat || descriptor.primaries !== 'srgb'
  || descriptor.transfer !== (sampleFormat === 'unorm8' ? 'srgb' : 'linear')) throw new RangeError('Native RAW frame differs from the full authenticated geometry/profile.');
 const pixels = field(input, 'pixels', 'native RAW physical frame'), Constructor = sampleFormat === 'unorm16' ? Uint16Array : sampleFormat === 'float32' ? Float32Array : Uint8Array;
 if (!(pixels instanceof Constructor) || Object.getPrototypeOf(pixels) !== Constructor.prototype) throw new TypeError('Native RAW requires its exact intrinsic sample plane.');
 for (const key of ['buffer', 'length', 'byteLength', 'byteOffset']) if (Object.hasOwn(pixels, key)) throw new TypeError('Native RAW plane may not shadow its physical geometry.');
 const buffer: unknown = Reflect.apply(BUFFER, pixels, []), length = width * height * 4 * (sampleFormat === 'unorm8' ? 1 : sampleFormat === 'unorm16' ? 2 : 4);
 if (!(buffer instanceof ArrayBuffer) || Reflect.apply(RESIZABLE, buffer, []) || Reflect.apply(SIZE, buffer, []) !== length
  || Reflect.apply(OFFSET, pixels, []) !== 0 || Reflect.apply(LENGTH, pixels, []) !== length) throw new RangeError('Native RAW requires dedicated fixed nonshared storage.');
 return readPixelFrameV1({ descriptor, pixels }, LIMITS);
}
function facts(input: Readonly<Record<string, unknown>>, profile: PhotoLibraryRawProfileCurrentV1) {
 const rawFlip = field(input, 'rawFlip', 'native RAW view'), exposureScale = field(input, 'exposureScale', 'native RAW view'), contentSha256 = field(input, 'contentSha256', 'native RAW view');
 if (field(input, 'profile', 'native RAW view') !== profile || typeof rawFlip !== 'number' || !Number.isSafeInteger(rawFlip) || rawFlip < 0 || rawFlip > 7
  || typeof exposureScale !== 'number' || !Number.isFinite(exposureScale) || exposureScale < 1 || exposureScale > 65536 || profile === 'canonical' && exposureScale !== 1
  || typeof contentSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(contentSha256)) throw new RangeError('Native RAW orientation/profile/normalization or output SHA is invalid.');
 return { decoder: decoder(field(input, 'decoder', 'native RAW view'), profile), profile, rawFlip, exposureScale, contentSha256 };
}
/** Shape/admission only: actual delivery owns full SHA authentication and the
 * scoped runtime alone may issue live computational fixed-profile authority. */
export function readPhotoLibraryRawFrameCurrentV1(value: unknown, request: Readonly<PhotoLibraryRawFrameRequestCurrentV1>): Readonly<PhotoLibraryRawFrameCurrentV1> {
 const input = record(value, 'native RAW frame view', FRAME_FIELDS);
 return Object.freeze({ ...facts(input, request.profile), frame: physical(field(input, 'frame', 'native RAW frame view'), request.profile === 'canonical' ? 'unorm16' : 'float32', request.original.width, request.original.height) });
}
/** Prepublication input has actual decoded geometry, not a fabricated stored
 * Photo/Original. Trusted owning input delivery authenticates complete bytes. */
export function readPhotoLibraryRawImportFrameCurrentV1(value: unknown, expected?: Readonly<{ byteLength: number; contentSha256: string }>): Readonly<PhotoLibraryRawImportFrameCurrentV1> {
 const input = record(value, 'native RAW import view', [...FRAME_FIELDS, 'input']);
 const source = record(field(input, 'input', 'native RAW import view'), 'native RAW input binding', ['byteLength', 'contentSha256']);
 const byteLength = field(source, 'byteLength', 'native RAW input binding'), sha = field(source, 'contentSha256', 'native RAW input binding');
 if (typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > 64 * 1024 * 1024
  || typeof sha !== 'string' || !/^[a-f0-9]{64}$/u.test(sha) || expected && (expected.byteLength !== byteLength || expected.contentSha256 !== sha)) throw new RangeError('Native RAW input differs from its actual completed source.');
 const frame = record(field(input, 'frame', 'native RAW import view'), 'native RAW import frame', ['descriptor', 'pixels']);
 const descriptor = readPixelFrameDescriptorV1(field(frame, 'descriptor', 'native RAW import frame'));
 return Object.freeze({ ...facts(input, 'canonical'), frame: physical(frame, 'unorm16', descriptor.width, descriptor.height), input: Object.freeze({ byteLength, contentSha256: sha }) });
}
export function readPhotoLibraryRawPreviewCurrentV1(value: unknown, request: Readonly<PhotoLibraryRawPreviewRequestCurrentV1>): Readonly<PhotoLibraryRawPreviewCurrentV1> {
 const input = record(value, 'native RAW preview view', [...FRAME_FIELDS, 'source', 'recipe']);
 const source = record(field(input, 'source', 'native RAW preview view'), 'native preview source', ['width', 'height']);
 if (field(source, 'width', 'native preview source') !== request.original.width || field(source, 'height', 'native preview source') !== request.original.height) throw new RangeError('Native preview full source geometry changed.');
 const recipe = record(field(input, 'recipe', 'native RAW preview view'), 'native preview recipe', ['id', 'version']);
 if (field(recipe, 'id', 'native preview recipe') !== 'lightscaper.native-original-preview.rgba8-nearest' || field(recipe, 'version', 'native preview recipe') !== 1) throw new RangeError('Native preview recipe is not the separate maintained profile.');
 const side = request.tier === 'thumbnail' ? 512 : 2048, size = fitPixelSizeV1(request.original.width, request.original.height, side, side);
 return Object.freeze({ ...facts(input, 'canonical'), profile: 'canonical', frame: physical(field(input, 'frame', 'native RAW preview view'), 'unorm8', size.width, size.height),
  source: Object.freeze({ width: request.original.width, height: request.original.height }), recipe: Object.freeze({ id: 'lightscaper.native-original-preview.rgba8-nearest', version: 1 }) });
}
export function capturePhotoLibraryRawSourceCurrentV1(value: undefined): undefined;
export function capturePhotoLibraryRawSourceCurrentV1(value: PhotoLibraryRawSourceCurrentV1): Readonly<PhotoLibraryRawSourceCurrentV1>;
export function capturePhotoLibraryRawSourceCurrentV1(value: unknown): Readonly<PhotoLibraryRawSourceCurrentV1> | undefined;
export function capturePhotoLibraryRawSourceCurrentV1(value: unknown): Readonly<PhotoLibraryRawSourceCurrentV1> | undefined {
 if (value === undefined) return undefined;
 if (value === null || typeof value !== 'object') throw new TypeError('Native RAW source requires actual scoped capabilities.');
 const withFrame: unknown = Reflect.get(value, 'withFrame'), withPreview: unknown = Reflect.get(value, 'withPreview');
 if (typeof withFrame !== 'function' || typeof withPreview !== 'function') throw new TypeError('Native RAW source requires both scoped methods.');
 return Object.freeze<PhotoLibraryRawSourceCurrentV1>({
  withFrame: <Result>(request: Readonly<PhotoLibraryRawFrameRequestCurrentV1>, consume: (view: Readonly<PhotoLibraryRawFrameCurrentV1>) => Result | Promise<Result>, options?: Options) =>
   Reflect.apply(withFrame, value, [request, consume, options]) as Promise<PhotoLibraryRawResultCurrentV1<Result>>,
  withPreview: <Result>(request: Readonly<PhotoLibraryRawPreviewRequestCurrentV1>, consume: (view: Readonly<PhotoLibraryRawPreviewCurrentV1>) => Result | Promise<Result>, options?: Options) =>
   Reflect.apply(withPreview, value, [request, consume, options]) as Promise<PhotoLibraryRawResultCurrentV1<Result>>,
 });
}
