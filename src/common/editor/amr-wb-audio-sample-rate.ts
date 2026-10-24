/* SPDX-License-Identifier: AGPL-3.0-only */
const MAGIC = [35, 33, 65, 77, 82, 45, 87, 66, 10];
// RFC4867 single-channel storage: one header octet plus octet-aligned speech bits.
const FRAME_BYTES: readonly (number | null)[] = [18, 24, 33, 37, 41, 47, 51, 59, 61, 6, null, null, null, null, 1, 1];

/** AMR-WB's native decoded clock is16k; other AMR/container profiles remain unqualified. */
export function inspectAmrWbAudioSampleRate(bytes: Uint8Array): number | null {
	if (bytes.length <= MAGIC.length || MAGIC.some((byte, index) => bytes[index] !== byte)) return null;
	let offset = MAGIC.length, frames = 0;
	while (offset < bytes.length) {
		if (++frames > 1_000_000) return null;
		const header = bytes[offset]!, size = FRAME_BYTES[(header >> 3) & 15];
		if ((header & 0x83) !== 0 || size == null || size > bytes.length - offset) return null;
		offset += size;
	}
	return 16_000;
}
