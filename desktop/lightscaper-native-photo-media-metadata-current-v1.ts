/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/foundation/closed-domain-value.ts';
import { captureLightscaperNativePhotoSettingCurrentV1 } from './lightscaper-native-photo-settings-codec-current-v1.ts';
import { readLightscaperNativeOriginalStorageKeyCurrentV1 as readKey } from './lightscaper-native-original-contract-current-v1.ts';

export type LightscaperNativePhotoMediaMetadataCurrentV1 = Readonly<object>;
interface Metadata { readonly assetId: string; readonly metadataPayload: Uint8Array }
interface Defaults { readonly name?: string; readonly mimeType?: string; readonly lastModified?: number }
const captures = new WeakMap<object, Readonly<Metadata>>(), CLONE = globalThis.structuredClone;

/** Reserved shared-media authority never enters caller descriptive metadata. */
export const LIGHTSCAPER_NATIVE_PHOTO_MEDIA_RESERVED_METADATA_CURRENT_V1: readonly string[] = Object.freeze([
	'key', 'sourceId', 'timestamp', 'type', 'storage', 'path', 'blob', 'size', 'mimeType', 'committedAt', 'pendingProjectUntil',
	'cacheToken', 'sha256', 'derivativeBindingVersion', 'originalSha256', 'originalMediaContentToken', 'recipeId', 'recipeVersion',
	'outputSha256', 'sourceToken', 'mediaChunkToken', 'mediaChunkBytes', 'mediaChunkCount', 'mediaContentDigestVersion',
	'mediaContentToken', 'catalogRootCount',
]);

/** Registers no body or digest authority. The composing owner registers before
 * calling this function; native clone capture precedes its first await. Blob
 * defaults come only from that wrapper's actual native Blob/File getters. */
export async function captureLightscaperNativePhotoMediaMetadataCurrentV1(assetIdValue: string, metadata: unknown = {},
	defaults: Readonly<Defaults> = {}): Promise<LightscaperNativePhotoMediaMetadataCurrentV1> {
	const assetId = readKey(assetIdValue), fallback = readDefaults(defaults);
	const snapshot = (metadata !== null && typeof metadata === 'object' ? CLONE(metadata) : {}) as Record<string, unknown>;
	const descriptive = { ...snapshot };
	for (const key of LIGHTSCAPER_NATIVE_PHOTO_MEDIA_RESERVED_METADATA_CURRENT_V1) delete descriptive[key];
	descriptive.name = String(snapshot.name || fallback.name || '');
	descriptive.mimeType = String(snapshot.mimeType || fallback.mimeType || '');
	const modified = Number(snapshot.lastModified ?? fallback.lastModified);
	descriptive.lastModified = Number.isFinite(modified) && modified >= 0 ? Math.floor(modified) : 0;
	const metadataPayload = await captureLightscaperNativePhotoSettingCurrentV1(descriptive);
	const token = Object.freeze({}); captures.set(token, Object.freeze({ assetId, metadataPayload })); return token;
}

/** Private brand lookup: a caller record, path or matching digest cannot
 * manufacture an admitted metadata capture or physical publication proof. */
export function readLightscaperNativePhotoMediaMetadataCurrentV1(value: unknown): Readonly<Metadata> {
	const captured = value !== null && typeof value === 'object' ? captures.get(value) : undefined;
	if (!captured) throw new TypeError('Native Photo media publication requires its genuine metadata capture.');
	return captured;
}
function readDefaults(value: Readonly<Defaults>): Required<Defaults> {
	const input = record(value, 'native Photo metadata defaults', ['name', 'mimeType', 'lastModified'], []);
	const name = Object.hasOwn(input, 'name') ? field(input, 'name', 'native Photo metadata defaults') : '';
	const mimeType = Object.hasOwn(input, 'mimeType') ? field(input, 'mimeType', 'native Photo metadata defaults') : '';
	const lastModified = Object.hasOwn(input, 'lastModified') ? field(input, 'lastModified', 'native Photo metadata defaults') : 0;
	if (typeof name !== 'string' || typeof mimeType !== 'string' || typeof lastModified !== 'number') throw new TypeError('Native Photo metadata defaults require descriptive scalar facts.');
	return { name, mimeType, lastModified };
}
