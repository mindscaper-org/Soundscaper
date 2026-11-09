/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ScapeArchiveByteSource } from '../common/scape/archive-byte-source.ts';
import { AEP_LIMITS } from '../common/editor/aep-container.ts';
/** Read only the capability the user selected. This never binds the AEP as a writable Save destination. */
export async function readMotionscaperNativeAepSource(input: ScapeArchiveByteSource, name: string, signal?: AbortSignal): Promise<File> {
	signal?.throwIfAborted();
	if (!Number.isSafeInteger(input.size) || input.size < 12 || input.size > AEP_LIMITS.bytes) throw new RangeError('Native AEP project exceeds its 64 MiB source budget.');
	if (!Number.isSafeInteger(input.maximumReadBytes) || input.maximumReadBytes < 1) throw new RangeError('Native AEP source range budget is invalid.');
	const bytes = new Uint8Array(input.size);
	for (let offset = 0; offset < input.size;) {
		const length = Math.min(1024 * 1024, input.maximumReadBytes, input.size - offset), chunk = await input.read({ offset, length, signal }); signal?.throwIfAborted();
		if (!(chunk instanceof Uint8Array) || chunk.length !== length) throw new RangeError('Native AEP source returned an incomplete range.');
		bytes.set(chunk, offset); offset += length;
	}
	return new File([bytes], name);
}
