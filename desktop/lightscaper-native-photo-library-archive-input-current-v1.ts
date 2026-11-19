/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertScapeArchiveByteSource, createScapeArchiveByteSource, createBlobScapeArchiveByteSource,
	type ScapeArchiveByteSource } from '../src/common/scape/archive-byte-source.ts';
import type { ScapeProjectInput } from '../src/common/editor/scape-project-input.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check } from './lightscaper-native-photo-media-lifetime-current-v1.ts';

const SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!, SLICE = Blob.prototype.slice;
export interface LightscaperNativePhotoLibraryArchiveInputCurrentV1 {
	readonly input: ScapeArchiveByteSource;
	readonly blob: Blob | null;
	close(): Promise<void>;
}

/** Shared archive reads may race cancellation. Native shutdown additionally
 * owns each real provider completion: invoke the branded base without its
 * optional cancellation race, stop admitting reads, then join all accepted IO.
 * Individual native input reads remain bounded by the existing source limit. */
export function ownLightscaperNativePhotoLibraryArchiveInputCurrentV1(input: ScapeProjectInput): Readonly<LightscaperNativePhotoLibraryArchiveInputCurrentV1> {
	let blob: Blob | null = null, source: ScapeArchiveByteSource;
	try { const size = Reflect.apply(SIZE, input, []) as number; blob = Reflect.apply(SLICE, input, [0, size]) as Blob; }
	catch { assertScapeArchiveByteSource(input); }
	if (blob) source = createBlobScapeArchiveByteSource(blob); else { assertScapeArchiveByteSource(input); source = input; }
	const read = source.read, active = new Set<Promise<Uint8Array>>(); let closed = false, closing: Promise<void> | null = null;
	const owned = createScapeArchiveByteSource({ size: source.size, maximumReadBytes: source.maximumReadBytes,
		async read(request): Promise<Uint8Array> {
			if (closed) throw new Error('Native archive input is closing.'); check(request.signal);
			// The actual base is branded and frozen. Its provider cannot be
			// replaced; omitting signal keeps the real read joined after abort.
			const work = Reflect.apply(read, source, [{ offset: request.offset, length: request.length }]) as Promise<Uint8Array>;
			active.add(work);
			try {
				const bytes = await work;
				try { check(request.signal); } catch (error) { bytes.fill(0); throw error; }
				return bytes;
			} finally { active.delete(work); }
		} });
	return Object.freeze({ input: owned, blob, close: (): Promise<void> => {
		if (closing) return closing; closed = true;
		closing = Promise.allSettled([...active]).then(() => undefined); return closing;
	} });
}
