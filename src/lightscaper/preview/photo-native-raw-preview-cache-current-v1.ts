/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { canonicalMediaContentBlob } from '../../common/editor/storage/media-content-digest.ts';
import type { BinaryDerivativeCacheIdentityV1, BinaryDerivativeCachePortV1 } from '../../common/editor/storage/binary-derivative-cache-repository.ts';
import { PHOTO_PREVIEW_CACHE_PROFILE_V1, type PhotoPreviewCacheStoreReceiptV1, type PhotoPreviewCacheTrimReceiptV1 } from './photo-preview-cache-v1.ts';
import { readPixelFrameDescriptorV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { normalizePhotoNativeRawPreviewPlanCurrentV1, planPhotoNativeRawPreviewCurrentV1, assertPhotoNativeRawPreviewMetadataCurrentV1,
 type PhotoNativeRawPreviewPlanCurrentV1 as Plan, type PreparedPhotoNativeRawPreviewCurrentV1 as Prepared } from './photo-native-raw-preview-current-v1.ts';
export interface PhotoNativeRawPreviewCachePortCurrentV1 {
 load(plan: unknown, signal?: AbortSignal): Promise<Readonly<Prepared> | null>;
 store(prepared: unknown, signal?: AbortSignal): Promise<PhotoPreviewCacheStoreReceiptV1>;
 trim(signal?: AbortSignal): Promise<PhotoPreviewCacheTrimReceiptV1>;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
export class PhotoNativeRawPreviewCacheCurrentV1 implements PhotoNativeRawPreviewCachePortCurrentV1 {
 readonly #core: BinaryDerivativeCachePortV1;
 constructor(core: BinaryDerivativeCachePortV1) {
  const input = record(core, 'native preview shared cache', ['load', 'store', 'trim']);
  for (const key of ['load', 'store', 'trim']) if (typeof field(input, key, 'native preview shared cache') !== 'function') throw new TypeError('Native preview requires complete shared cache methods.');
  this.#core = Object.freeze({ load: core.load.bind(core), store: core.store.bind(core), trim: core.trim.bind(core) });
 }
 async load(value: unknown, signal?: AbortSignal): Promise<Readonly<Prepared> | null> {
  check(signal); const plan = normalizePhotoNativeRawPreviewPlanCurrentV1(value), expected = identity(plan), cached = await this.#core.load(expected, signal); check(signal);
  if (cached === null) return null;
  const input = record(cached, 'cached native RAW preview', ['identity', 'body', 'outputSha256']);
  const actual = record(field(input, 'identity', 'cached native RAW preview'), 'native preview cache identity', Object.keys(expected));
  for (const [key, value] of Object.entries(expected)) if (field(actual, key, 'native preview cache identity') !== value) throw new RangeError('Native preview shared cache identity changed.');
  const body = canonicalMediaContentBlob(field(input, 'body', 'cached native RAW preview')), sha = digest(field(input, 'outputSha256', 'cached native RAW preview'));
  if (body.size !== plan.byteLength) throw new RangeError('Native preview cached body length changed.'); return prepared(plan, body, sha);
 }
 async store(value: unknown, signal?: AbortSignal): Promise<PhotoPreviewCacheStoreReceiptV1> {
  check(signal); const input = record(value, 'prepared native RAW preview', ['schemaVersion', 'kind', 'key', 'binding', 'tier', 'recipe', 'decoder', 'descriptor', 'byteLength', 'outputSha256', 'body']);
  const plan = planPhotoNativeRawPreviewCurrentV1({ binding: field(input, 'binding', 'prepared native RAW preview'), tier: field(input, 'tier', 'prepared native RAW preview') });
  for (const [key, expected] of Object.entries({ schemaVersion: 1, kind: 'photo-preview', key: plan.key, byteLength: plan.byteLength })) {
   if (field(input, key, 'prepared native RAW preview') !== expected) throw new RangeError('Native preview prepared scalar changed.');
  }
  assertPhotoNativeRawPreviewMetadataCurrentV1(field(input, 'recipe', 'prepared native RAW preview'), plan.recipe, 'native prepared recipe');
  assertPhotoNativeRawPreviewMetadataCurrentV1(field(input, 'decoder', 'prepared native RAW preview'), plan.decoder, 'native prepared decoder');
  if (JSON.stringify(readPixelFrameDescriptorV1(field(input, 'descriptor', 'prepared native RAW preview'))) !== JSON.stringify(plan.output)) throw new RangeError('Native preview output descriptor changed.');
  const body = canonicalMediaContentBlob(field(input, 'body', 'prepared native RAW preview')), sha = digest(field(input, 'outputSha256', 'prepared native RAW preview'));
  if (body.size !== plan.byteLength) throw new RangeError('Native preview prepared body length changed.');
  return this.#core.store(identity(plan), body, sha, signal);
 }
 async trim(signal?: AbortSignal): Promise<PhotoPreviewCacheTrimReceiptV1> { check(signal); return this.#core.trim(signal); }
}
function identity(plan: Readonly<Plan>): BinaryDerivativeCacheIdentityV1 {
 return Object.freeze({ schemaVersion: 1, kind: PHOTO_PREVIEW_CACHE_PROFILE_V1.kind, key: plan.key, sourceId: plan.binding.storageKey,
  originalSha256: plan.binding.contentSha256, originalByteLength: plan.binding.byteLength, recipeId: plan.recipe.id, recipeVersion: plan.recipe.version,
  byteLength: plan.byteLength, metadata: JSON.stringify(plan) });
}
function prepared(plan: Readonly<Plan>, body: Blob, outputSha256: string): Readonly<Prepared> {
 return Object.freeze({ schemaVersion: 1, kind: 'photo-preview', key: plan.key, binding: plan.binding, tier: plan.tier, decoder: plan.decoder,
  recipe: plan.recipe, descriptor: plan.output, byteLength: plan.byteLength, outputSha256, body });
}
function digest(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('Native preview requires a full lowercase output SHA.'); return value; }
