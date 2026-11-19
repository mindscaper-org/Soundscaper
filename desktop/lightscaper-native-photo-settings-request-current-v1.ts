/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalKeyValueComparison } from '../src/common/editor/storage/key-value-canonical-comparison.ts';
import type { KeyValueWriteAdmission } from '../src/common/editor/storage/key-value-repository.ts';
import type { PhotoMediaSettingsRepositoryV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { captureLightscaperNativePhotoSettingCurrentV1 } from './lightscaper-native-photo-settings-codec-current-v1.ts';

type Key = Readonly<{ key: Uint8Array }>;
export type LightscaperNativePhotoSettingsRequestCurrentV1 =
	| (Key & Readonly<{ method: 'get' | 'readEntry' | 'delete' }>)
	| (Key & Readonly<{ method: 'put' | 'putIfAbsent'; payload: Uint8Array }>)
	| (Key & Readonly<{ method: 'replaceIfCurrent'; expected: string; payload: Uint8Array }>)
	| (Key & Readonly<{ method: 'deleteIfCurrent'; expected: string }>)
	| (Key & Readonly<{ method: 'replaceIfCurrentAndPutIfAbsent'; expected: string; payload: Uint8Array;
		intentKey: Uint8Array; intentPayload: Uint8Array; admission?: KeyValueWriteAdmission }>);

/** SQLite TEXT cannot retain lone surrogates or embedded NUL key identity.
 * Fixed big-endian code units also keep the empty JavaScript key distinct. */
export function encodeLightscaperNativePhotoSettingKeyCurrentV1(value: unknown): Uint8Array {
	if (typeof value !== 'string') throw new TypeError('Native Photo setting keys must be strings.');
	const bytes = new Uint8Array(value.length * 2);
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index); bytes[index * 2] = code >>> 8; bytes[index * 2 + 1] = code & 255;
	}
	return bytes;
}

/** Called only after the lifetime registers this request and its queue tail. */
export async function captureLightscaperNativePhotoSettingsRequestCurrentV1(
	method: keyof PhotoMediaSettingsRepositoryV1, args: readonly unknown[], scope: string,
): Promise<LightscaperNativePhotoSettingsRequestCurrentV1> {
	const key = encodeLightscaperNativePhotoSettingKeyCurrentV1(args[0]);
	if (method === 'get' || method === 'readEntry' || method === 'delete') return { method, key };
	if (method === 'put' || method === 'putIfAbsent') {
		return { method, key, payload: await captureLightscaperNativePhotoSettingCurrentV1(args[1]) };
	}
	if (method === 'replaceIfCurrentAndPutIfAbsent') {
		if (scope !== 'anchor') throw new Error('Native restore publication requires the fixed settings anchor.');
		const intentKey = encodeLightscaperNativePhotoSettingKeyCurrentV1(args[3]);
		if (args[0] === args[3]) throw new Error('A conditional replacement needs a distinct intent key.');
		const admission = args[5];
		if (admission !== undefined && typeof admission !== 'function') throw new TypeError('Atomic key/value admission must be synchronous callable behavior.');
		const expected = canonicalKeyValueComparison(args[1]);
		// Both clone captures start before the first await, independently of
		// Blob encoding completion and later mutations of borrowed arguments.
		const captures = [
			captureLightscaperNativePhotoSettingCurrentV1(args[2]), captureLightscaperNativePhotoSettingCurrentV1(args[4]),
		] as const;
		let payload: Uint8Array, intentPayload: Uint8Array;
		try { [payload, intentPayload] = await Promise.all(captures); }
		catch (primary) { await Promise.allSettled(captures); throw primary; }
		return { method, key, expected, payload, intentKey, intentPayload, admission: admission as KeyValueWriteAdmission | undefined };
	}
	const expected = canonicalKeyValueComparison(args[1]);
	if (method === 'deleteIfCurrent') return { method, key, expected };
	return { method, key, expected, payload: await captureLightscaperNativePhotoSettingCurrentV1(args[2]) };
}
