/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/foundation/closed-domain-value.ts';
import { planPixelFrameV1, readPixelFrameDescriptorV1, type PixelFrameDescriptorV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { fitPixelSizeV1 } from '../../common/editor/imaging/pixel-frame-resize-v1.ts';
import { normalizePhotoPreviewOriginalBindingV1, type PhotoPreviewOriginalBindingV1, type PhotoPreviewTierV1 } from './photo-preview-plan-v1.ts';
import type { PhotoLibraryRawDecoderCurrentV1, PhotoLibraryRawPreviewCurrentV1 } from '../controller/photo-library-raw-source-current-v1.ts';
export const PHOTO_NATIVE_RAW_PREVIEW_RECIPE_CURRENT_V1 = Object.freeze({ id: 'lightscaper.native-original-preview.rgba8-nearest', version: 1 as const });
export const PHOTO_NATIVE_RAW_PREVIEW_DECODER_CURRENT_V1: Readonly<PhotoLibraryRawDecoderCurrentV1> = Object.freeze({ schemaVersion: 1, engine: 'lightscaper-libraw-native', engineVersion: 1,
 upstream: '0.22.2', profile: 'neutral-linear-srgb16', profileVersion: 1 });
export interface PhotoNativeRawPreviewPlanCurrentV1 {
 readonly schemaVersion: 1; readonly kind: 'photo-native-raw-preview-plan'; readonly key: string;
 readonly binding: Readonly<PhotoPreviewOriginalBindingV1>; readonly source: Readonly<PixelFrameDescriptorV1>;
 readonly decoder: typeof PHOTO_NATIVE_RAW_PREVIEW_DECODER_CURRENT_V1; readonly recipe: typeof PHOTO_NATIVE_RAW_PREVIEW_RECIPE_CURRENT_V1;
 readonly tier: PhotoPreviewTierV1; readonly output: Readonly<PixelFrameDescriptorV1>; readonly byteLength: number;
}
export interface PreparedPhotoNativeRawPreviewCurrentV1 {
 readonly schemaVersion: 1; readonly kind: 'photo-preview'; readonly key: string; readonly binding: Readonly<PhotoPreviewOriginalBindingV1>;
 readonly tier: PhotoPreviewTierV1; readonly recipe: typeof PHOTO_NATIVE_RAW_PREVIEW_RECIPE_CURRENT_V1;
 readonly decoder: typeof PHOTO_NATIVE_RAW_PREVIEW_DECODER_CURRENT_V1; readonly descriptor: Readonly<PixelFrameDescriptorV1>;
 readonly byteLength: number; readonly outputSha256: string; readonly body: Blob;
}
const FIELDS = ['schemaVersion', 'kind', 'key', 'binding', 'source', 'decoder', 'recipe', 'tier', 'output', 'byteLength'];
const BUFFER = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, 'buffer')!.get!;

/** A separate native recipe/key. The permanent Web nearest plan is unchanged. */
export function planPhotoNativeRawPreviewCurrentV1(value: unknown): Readonly<PhotoNativeRawPreviewPlanCurrentV1> {
 const input = record(value, 'native RAW preview plan request', ['binding', 'tier']);
 const binding = normalizePhotoPreviewOriginalBindingV1(field(input, 'binding', 'native RAW preview plan request'));
 const tier = field(input, 'tier', 'native RAW preview plan request');
 if (tier !== 'thumbnail' && tier !== 'fit-screen') throw new RangeError('Native RAW preview requires an explicit tier.');
 const source = planPixelFrameV1({ schemaVersion: 1, width: binding.width, height: binding.height, sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' },
  { maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 128 * 1024 * 1024 }).descriptor;
 const side = tier === 'thumbnail' ? 512 : 2048, fitted = fitPixelSizeV1(binding.width, binding.height, side, side);
 const output = Object.freeze({ schemaVersion: 1 as const, ...fitted, sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const });
 const byteLength = planPixelFrameV1(output, { maximumSidePixels: side, maximumPixels: side * side, maximumBytes: side * side * 4 }).byteLength;
 const decoder = PHOTO_NATIVE_RAW_PREVIEW_DECODER_CURRENT_V1, recipe = PHOTO_NATIVE_RAW_PREVIEW_RECIPE_CURRENT_V1;
 const key = `photo-preview-sha256:${bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(['lightscaper-native-raw-preview', 1, binding, source, decoder, tier, recipe, output]))))}`;
 return Object.freeze({ schemaVersion: 1, kind: 'photo-native-raw-preview-plan', key, binding, source, decoder, tier, recipe, output, byteLength });
}
export function normalizePhotoNativeRawPreviewPlanCurrentV1(value: unknown): Readonly<PhotoNativeRawPreviewPlanCurrentV1> {
 const input = record(value, 'native RAW preview plan', FIELDS);
 const plan = planPhotoNativeRawPreviewCurrentV1({ binding: field(input, 'binding', 'native RAW preview plan'), tier: field(input, 'tier', 'native RAW preview plan') });
 for (const key of ['schemaVersion', 'kind', 'key', 'byteLength']) if (field(input, key, 'native RAW preview plan') !== Reflect.get(plan, key)) throw new RangeError('Native RAW preview plan has a different derived scalar.');
 for (const key of ['source', 'output']) if (JSON.stringify(readPixelFrameDescriptorV1(field(input, key, 'native RAW preview plan'))) !== JSON.stringify(Reflect.get(plan, key))) throw new RangeError('Native RAW preview source/output descriptor changed.');
 assertPhotoNativeRawPreviewMetadataCurrentV1(field(input, 'decoder', 'native RAW preview plan'), plan.decoder, 'native preview decoder');
 assertPhotoNativeRawPreviewMetadataCurrentV1(field(input, 'recipe', 'native RAW preview plan'), plan.recipe, 'native preview recipe');
 return plan;
}
export function preparePhotoNativeRawPreviewCurrentV1(planValue: unknown, native: Readonly<PhotoLibraryRawPreviewCurrentV1>): Readonly<PreparedPhotoNativeRawPreviewCurrentV1> {
 const plan = normalizePhotoNativeRawPreviewPlanCurrentV1(planValue), descriptor = readPixelFrameDescriptorV1(native.frame.descriptor);
 if (JSON.stringify(descriptor) !== JSON.stringify(plan.output) || JSON.stringify(native.decoder) !== JSON.stringify(plan.decoder)
  || JSON.stringify(native.recipe) !== JSON.stringify(plan.recipe) || native.source.width !== plan.binding.width || native.source.height !== plan.binding.height) throw new RangeError('Actual native preview differs from its separate plan.');
 const backing = Reflect.apply(BUFFER, native.frame.pixels, []) as ArrayBuffer;
 const body = new Blob([new Uint8Array(backing)], { type: 'application/vnd.scaper.rgba8' });
 if (body.size !== plan.byteLength) throw new RangeError('Actual native preview has a different physical output size.');
 return Object.freeze({ schemaVersion: 1, kind: 'photo-preview', key: plan.key, binding: plan.binding, tier: plan.tier, decoder: plan.decoder,
  recipe: plan.recipe, descriptor: plan.output, byteLength: plan.byteLength, outputSha256: native.contentSha256, body });
}

export function assertPhotoNativeRawPreviewMetadataCurrentV1(value: unknown, expected: object, label: string): void {
 const input = record(value, label, Object.keys(expected));
 for (const [key, scalar] of Object.entries(expected)) if (field(input, key, label) !== scalar) throw new RangeError(`${label} changed.`);
}
