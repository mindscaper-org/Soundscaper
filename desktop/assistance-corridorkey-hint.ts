/* SPDX-License-Identifier: AGPL-3.0-only */

import { createChromaKeyMatte } from '../src/common/editor/video-chroma-key.ts';
import type { CorridorKeyHintSettings } from '../src/common/editor/assistance/corridorkey-hint-settings.ts';
import type { CorridorKeyPixelGeometryV1, CorridorKeyRasterV1 } from '../src/common/editor/assistance/corridorkey-pixels-v1.ts';

/** The ordinary keyer's matte guides stage one; RGB and recurrent features stay original. */
export function createCorridorKeyHint(frame: CorridorKeyRasterV1, geometry: CorridorKeyPixelGeometryV1,
	settings: CorridorKeyHintSettings): Float32Array {
	const hint = new Float32Array(geometry.paddedWidth * geometry.paddedHeight);
	if (settings.hintMode === 'none') return hint;
	const matte = createChromaKeyMatte(frame, settings);
	for (let y = 0; y < geometry.paddedHeight; y += 1) {
		const row = reflect(y - geometry.padTop, frame.height) * frame.width;
		for (let x = 0; x < geometry.paddedWidth; x += 1) {
			hint[y * geometry.paddedWidth + x] = matte[row + reflect(x - geometry.padLeft, frame.width)]!;
		}
	}
	return hint;
}
function reflect(coordinate: number, size: number): number {
	if (size === 1) return 0;
	const period = 2 * size - 2;
	const position = (coordinate % period + period) % period;
	return position < size ? position : period - position;
}
