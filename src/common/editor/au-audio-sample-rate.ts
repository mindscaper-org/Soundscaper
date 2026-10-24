/* SPDX-License-Identifier: AGPL-3.0-only */

const SAMPLE_BYTES: ReadonlyMap<number, number> = new Map([[1, 1], [2, 1], [3, 2], [4, 3], [5, 4], [6, 4], [7, 8], [27, 1]]);

/** Sun au(4): a 24-byte big-endian header owns the decoded PCM/companded sample clock. */
export function inspectAuAudioSampleRate(bytes: Uint8Array): number | null {
	if (bytes.byteLength < 24) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0) !== 0x2e736e64) return null;
	const offset = view.getUint32(4), declaredBytes = view.getUint32(8), sampleBytes = SAMPLE_BYTES.get(view.getUint32(12));
	const sampleRate = view.getUint32(16), channels = view.getUint32(20);
	if (!sampleBytes || offset < 24 || offset > bytes.length || channels < 1 || channels > 64
		|| sampleRate < 1000 || sampleRate > 1_000_000) return null;
	const available = bytes.length - offset, dataBytes = declaredBytes === 0xffff_ffff ? available : declaredBytes;
	if (dataBytes < 1 || dataBytes > available || dataBytes % (channels * sampleBytes) !== 0) return null;
	return sampleRate;
}
