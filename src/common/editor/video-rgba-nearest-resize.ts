/* SPDX-License-Identifier: AGPL-3.0-only */

/** Resize validated RGBA bytes without creating an intermediate view per texel. */
export function resizeVideoRgbaNearest(
	source: Readonly<{ pixels: Uint8Array; width: number; height: number }>,
	width: number,
	height: number,
	destinationOffset: 0 | 0.5,
	checkRow?: () => void,
): Uint8Array<ArrayBuffer> {
	const output = new Uint8Array(width * height * 4);
	const inputWords = new DataView(source.pixels.buffer, source.pixels.byteOffset, source.pixels.byteLength);
	const outputWords = new DataView(output.buffer);
	const columns = new Uint32Array(width);
	for (let x = 0; x < width; x += 1) {
		columns[x] = Math.min(source.width - 1, Math.floor((x + destinationOffset) * source.width / width)) * 4;
	}
	for (let y = 0; y < height; y += 1) {
		checkRow?.();
		const sourceY = Math.min(source.height - 1, Math.floor((y + destinationOffset) * source.height / height));
		const sourceRow = sourceY * source.width * 4;
		const outputRow = y * width * 4;
		for (let x = 0; x < width; x += 1) {
			outputWords.setUint32(outputRow + x * 4, inputWords.getUint32(sourceRow + columns[x]!));
		}
	}
	return output;
}
