/* SPDX-License-Identifier: AGPL-3.0-only */

/** FFmpeg's unseekable RIFF output leaves both container and terminal data
 * lengths unknown. A completed Blob supplies their bounds without guessing at
 * chunk-like bytes inside PCM. Ordinary finite-size containers remain strict.
 */
export function createRiffStreamingSizeResolver(declaredRiffBytes: number, fileSize: number) {
	if (declaredRiffBytes !== 0xffff_ffff) return null;
	let dataSeen = false;
	let resolved = false;
	return {
		riffEnd: fileSize,
		resolveChunk(id: string, declaredBytes: number, payloadOffset: number): Readonly<{ byteLength: number; paddedEnd: number }> | null {
			if (id !== 'data') return null;
			const first = !dataSeen;
			dataSeen = true;
			if (!first || declaredBytes !== 0xffff_ffff) return null;
			resolved = true;
			return { byteLength: fileSize - payloadOffset, paddedEnd: fileSize };
		},
		assertComplete(): void {
			if (!resolved) throw new RangeError('An unknown RIFF size requires a terminal unknown-size data chunk.');
		},
	};
}
