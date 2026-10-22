/* SPDX-License-Identifier: AGPL-3.0-only */
import { types } from 'node:util';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
export const LIGHTSCAPER_NATIVE_PHOTO_RAW_CHUNK_CURRENT_V1 = 1024 * 1024;
export const LIGHTSCAPER_NATIVE_PHOTO_RAW_INPUT_CURRENT_V1 = 64 * 1024 * 1024;
export const LIGHTSCAPER_NATIVE_PHOTO_RAW_OUTPUT_CURRENT_V1 = 256 * 1024 * 1024;
export type LightscaperNativePhotoRawModeCurrentV1 = 'neutral' | 'linear-headroom' | 'highlight-recovery' | 'embedded';
export type LightscaperNativePhotoRawTierCurrentV1 = null | 'thumbnail' | 'fit-screen';
export type LightscaperNativePhotoRawFormatCurrentV1 = 'none' | 'rgba16le' | 'rgba32fle' | 'rgba8' | 'jpeg' | 'bitmap8' | 'bitmap16le';
export interface LightscaperNativePhotoRawDecodedCurrentV1 {
 readonly engine: 'lightscaper-libraw-native'; readonly engineVersion: 1; readonly upstream: '0.22.2';
 readonly mode: LightscaperNativePhotoRawModeCurrentV1; readonly tier: LightscaperNativePhotoRawTierCurrentV1; readonly recipe: string | null;
 readonly format: LightscaperNativePhotoRawFormatCurrentV1; readonly width: number; readonly height: number; readonly channels: number; readonly bits: number;
 readonly rawFlip: number; readonly exposureScale: number; readonly byteLength: number; readonly contentSha256: string; readonly bytes: Uint8Array<ArrayBuffer>;
}
export interface LightscaperNativePhotoRawRequestCurrentV1 {
 readonly mode: LightscaperNativePhotoRawModeCurrentV1; readonly tier: LightscaperNativePhotoRawTierCurrentV1;
 readonly byteLength: number; readonly contentSha256: string;
 read(offset: number, length: number, signal: AbortSignal): Promise<unknown>;
}
export const LIGHTSCAPER_NATIVE_PHOTO_RAW_MODES_CURRENT_V1 = Object.freeze(['neutral', 'linear-headroom', 'highlight-recovery', 'embedded'] as const);
export const LIGHTSCAPER_NATIVE_PHOTO_RAW_TIERS_CURRENT_V1 = Object.freeze([null, 'thumbnail', 'fit-screen'] as const);
const FORMATS = ['none', 'rgba16le', 'rgba32fle', 'rgba8', 'jpeg', 'bitmap8', 'bitmap16le'] as const;
const NativeBytes = Uint8Array, SET = NativeBytes.prototype.set;
const TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!, RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;

export function captureLightscaperNativePhotoRawRequestCurrentV1(value: unknown): Readonly<LightscaperNativePhotoRawRequestCurrentV1> {
 const input = record(value, 'native RAW request', ['mode', 'tier', 'source']);
 const mode = field(input, 'mode', 'native RAW request'), tier = field(input, 'tier', 'native RAW request');
 if (!LIGHTSCAPER_NATIVE_PHOTO_RAW_MODES_CURRENT_V1.some(item => item === mode) || !LIGHTSCAPER_NATIVE_PHOTO_RAW_TIERS_CURRENT_V1.some(item => item === tier)
  || mode === 'embedded' && tier !== null) throw new RangeError('Native RAW mode/tier is unsupported.');
 const source = field(input, 'source', 'native RAW request');
 if (typeof source !== 'object' || source === null) throw new TypeError('Native RAW requires its Main-owned bounded source.');
 const size = Object.getOwnPropertyDescriptor(source, 'byteLength'), sha = Object.getOwnPropertyDescriptor(source, 'contentSha256');
 if (!size || !Object.hasOwn(size, 'value') || !sha || !Object.hasOwn(sha, 'value')) throw new TypeError('Native RAW source facts must be own data.');
 const byteLength: unknown = size.value, contentSha256: unknown = sha.value, read: unknown = Reflect.get(source, 'read');
 if (typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > LIGHTSCAPER_NATIVE_PHOTO_RAW_INPUT_CURRENT_V1
  || typeof contentSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(contentSha256) || typeof read !== 'function') throw new RangeError('Native RAW source length, SHA or reader is invalid.');
 return Object.freeze({ mode: mode as LightscaperNativePhotoRawModeCurrentV1, tier: tier as LightscaperNativePhotoRawTierCurrentV1,
  byteLength, contentSha256, read: (offset: number, length: number, signal: AbortSignal) => Reflect.apply(read, source, [offset, length, Object.freeze({ signal })]) as Promise<unknown> });
}
export function copyLightscaperNativePhotoRawChunkCurrentV1(value: unknown, length: number): Uint8Array<ArrayBuffer> {
 if (!types.isUint8Array(value) || Reflect.apply(LENGTH, value, []) !== length) throw new TypeError('Native RAW source returned a nonexact byte chunk.');
 const buffer: unknown = Reflect.apply(BUFFER, value, []), offset = Reflect.apply(OFFSET, value, []) as number;
 if (!types.isArrayBuffer(buffer) || Reflect.apply(RESIZABLE, buffer, []) || Reflect.apply(SIZE, buffer, []) < offset + length)
  throw new TypeError('Native RAW source requires fixed native byte storage.');
 const result = new NativeBytes(length); Reflect.apply(SET, result, [value]); return result;
}
export type LightscaperNativePhotoRawHeaderCurrentV1 = Readonly<Omit<LightscaperNativePhotoRawDecodedCurrentV1, 'bytes'>>;
export function readLightscaperNativePhotoRawHeaderCurrentV1(payload: Buffer, request: Readonly<LightscaperNativePhotoRawRequestCurrentV1>): LightscaperNativePhotoRawHeaderCurrentV1 {
 if (payload.byteLength !== 64 || payload[0] !== LIGHTSCAPER_NATIVE_PHOTO_RAW_MODES_CURRENT_V1.indexOf(request.mode) + 1
  || payload[1] !== LIGHTSCAPER_NATIVE_PHOTO_RAW_TIERS_CURRENT_V1.indexOf(request.tier) || payload.readUInt16BE(14) !== 0)
  throw new TypeError('Native RAW result profile/header differs from its actual request.');
 const format = FORMATS[payload[2]!], rawFlip = payload[3]!, width = payload.readUInt32BE(4), height = payload.readUInt32BE(8);
 const channels = payload[12]!, bits = payload[13]!, length = payload.readBigUInt64BE(16), exposureScale = payload.readDoubleBE(24);
 if (!format || length > BigInt(LIGHTSCAPER_NATIVE_PHOTO_RAW_OUTPUT_CURRENT_V1) || rawFlip > 7 || !Number.isFinite(exposureScale)
  || exposureScale < 1 || exposureScale > 65536) throw new RangeError('Native RAW output scalars exceed their fixed profile.');
 const byteLength = Number(length), contentSha256 = payload.subarray(32, 64).toString('hex');
 if (format === 'none') {
  if (request.mode !== 'embedded' || request.tier !== null || width || height || channels || bits || byteLength || exposureScale !== 1) throw new RangeError('Native missing embedded result is invalid.');
 } else {
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16_777_216 || !byteLength) throw new RangeError('Native RAW output geometry is invalid.');
  if (request.tier !== null) {
   const side = request.tier === 'thumbnail' ? 512 : 2048;
   if (format !== 'rgba8' || channels !== 4 || bits !== 8 || width > side || height > side || byteLength !== width * height * 4) throw new RangeError('Native preview result differs from its fixed tier.');
  } else if (request.mode === 'neutral') {
   if (format !== 'rgba16le' || channels !== 4 || bits !== 16 || byteLength !== width * height * 8 || exposureScale !== 1) throw new RangeError('Native neutral plane is invalid.');
  } else if (request.mode === 'embedded') {
   if (byteLength > 16 * 1024 * 1024 || (channels !== 1 && channels !== 3) || exposureScale !== 1
    || !(format === 'jpeg' && bits === 8 || format === 'bitmap8' && bits === 8 && byteLength === width * height * channels
     || format === 'bitmap16le' && bits === 16 && byteLength === width * height * channels * 2)) throw new RangeError('Native embedded representation is invalid.');
  } else if (format !== 'rgba32fle' || channels !== 4 || bits !== 32 || width < 16 || height < 16 || byteLength !== width * height * 16) throw new RangeError('Native derived plane is invalid.');
 }
 return Object.freeze({ engine: 'lightscaper-libraw-native', engineVersion: 1, upstream: '0.22.2', mode: request.mode, tier: request.tier,
  recipe: request.tier === null ? null : 'lightscaper.native-original-preview.rgba8-nearest/v1', format, width, height, channels, bits, rawFlip, exposureScale, byteLength, contentSha256 });
}
