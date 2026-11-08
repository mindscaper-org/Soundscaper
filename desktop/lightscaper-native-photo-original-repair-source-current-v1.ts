/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { types } from 'node:util';
import { consumeLightscaperNativePhotoUploadFileCurrentV1 as consume,
	type LightscaperNativePhotoUploadReadCurrentV1 as View } from './lightscaper-native-photo-upload-file-current-v1.ts';
import { LIGHTSCAPER_NATIVE_ORIGINAL_CHUNK_BYTES_CURRENT_V1 as CHUNK } from './lightscaper-native-original-contract-current-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
export type LightscaperNativePhotoOriginalRepairSourceCurrentV1 = Readonly<object>;
interface Capture { readonly actual: Readonly<View>; readonly read: View['read']; readonly close: View['close']; closing?: Promise<void>; failed: boolean }
const captures = new WeakMap<object, Capture>(), live = new Set<Capture>();
/** Only the actual completed-file owner's one-use proof enters this seam.
 * Its owned view is registered before any caller binding/iterator reflection. */
export function captureLightscaperNativePhotoOriginalRepairSourceCurrentV1(database: DatabaseSync, proof: unknown): LightscaperNativePhotoOriginalRepairSourceCurrentV1 {
	const actual = consume(proof, database), captured: Capture = { actual, read: actual.read, close: actual.close, failed: false };
	const token = Object.freeze({}); live.add(captured); captures.set(token, captured); return token;
}
export function readLightscaperNativePhotoOriginalRepairSourceCurrentV1(value: unknown): Readonly<{ byteLength: number; contentSha256: string }> {
	const captured = read(value); return Object.freeze({ byteLength: captured.actual.byteLength, contentSha256: captured.actual.contentSha256 });
}
export async function digestLightscaperNativePhotoOriginalRepairSourceCurrentV1(value: LightscaperNativePhotoOriginalRepairSourceCurrentV1, signal?: AbortSignal): Promise<string> {
	const hash = createHash('sha256'); for await (const bytes of emit(read(value), signal)) hash.update(bytes);
	check(signal); const digest = hash.digest('hex');
	if (digest !== read(value).actual.contentSha256) throw new Error('Completed native upload changed its actual full SHA.'); return digest;
}
export function lightscaperNativePhotoOriginalRepairSourceChunksCurrentV1(value: LightscaperNativePhotoOriginalRepairSourceCurrentV1, signal?: AbortSignal): AsyncIterable<Uint8Array> {
	return emit(read(value), signal);
}
export function closeLightscaperNativePhotoOriginalRepairSourceCurrentV1(value: LightscaperNativePhotoOriginalRepairSourceCurrentV1): Promise<void> {
	const captured = read(value); if (captured.closing) return captured.closing;
	let resolve!: () => void, reject!: (error: unknown) => void;
	captured.closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
	let work: Promise<void>;
	try { work = Reflect.apply(captured.close, captured.actual, []) as Promise<void>; } catch (error) { work = Promise.reject(error); }
	void work.then(() => { live.delete(captured); resolve(); }, (error: unknown) => { captured.failed = true; reject(error); }); return captured.closing;
}
export function hasLightscaperNativePhotoOriginalRepairSourceRetirementFailureCurrentV1(value: LightscaperNativePhotoOriginalRepairSourceCurrentV1): boolean { return read(value).failed; }
function read(value: unknown): Capture {
	const captured = value !== null && typeof value === 'object' ? captures.get(value) : undefined;
	if (!captured) throw new TypeError('Native repair requires its genuine completed-file source capture.'); return captured;
}
async function* emit(captured: Capture, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
	if (captured.closing) throw new Error('Native repair source is closing.');
	for (let offset = 0; offset < captured.actual.byteLength;) {
		check(signal); const length = Math.min(CHUNK, captured.actual.byteLength - offset);
		const bytes: unknown = await Reflect.apply(captured.read, captured.actual, [offset, length, { signal }]);
		if (!types.isUint8Array(bytes) || bytes.byteLength !== length) throw new Error('Actual native upload range changed its bounded length.');
		try { check(signal); offset += length; yield bytes; } finally { bytes.fill(0); }
	}
	check(signal);
}
