/* SPDX-License-Identifier: AGPL-3.0-only */

import type { GrayVideoFrameV1, ShiTomasiFeatureV1 } from './video-motion-processing-v27.ts';

/** Compute each neighborhood sample once while retaining the original sum order. */
export function collectShiTomasiCandidatesV1(frame: GrayVideoFrameV1): Readonly<{
	candidates: ShiTomasiFeatureV1[];
	maximumScore: number;
}> {
	const candidates: ShiTomasiFeatureV1[] = [];
	let maximumScore = 0;
	const { width, height, samples } = frame;
	if (width < 5 || height < 5) return { candidates, maximumScore };
	const rowLength = width * 3;
	const rows = new Float64Array(rowLength * 3);
	function computeRow(y: number): void {
		const gradientRow = y % 3 * rowLength;
		const sourceRow = y * width;
		for (let x = 1; x < width - 1; x += 1) {
			const offset = sourceRow + x;
			const gx = (samples[offset + 1]! - samples[offset - 1]!) / 2;
			const gy = (samples[offset + width]! - samples[offset - width]!) / 2;
			const index = gradientRow + x * 3;
			rows[index] = gx * gx;
			rows[index + 1] = gx * gy;
			rows[index + 2] = gy * gy;
		}
	}
	computeRow(1);
	computeRow(2);
	for (let y = 2; y < height - 2; y += 1) {
		computeRow(y + 1);
		for (let x = 2; x < width - 2; x += 1) {
			let xx = 0;
			let xy = 0;
			let yy = 0;
			for (let oy = -1; oy <= 1; oy += 1) {
				const offset = (y + oy) % 3 * rowLength + (x - 1) * 3;
				for (let index = offset; index < offset + 9; index += 3) {
					xx += rows[index]!;
					xy += rows[index + 1]!;
					yy += rows[index + 2]!;
				}
			}
			const trace = xx + yy;
			const discriminant = Math.sqrt(Math.max(0, (xx - yy) ** 2 + 4 * xy ** 2));
			const score = (trace - discriminant) / 2;
			if (score <= 0) continue;
			maximumScore = Math.max(maximumScore, score);
			candidates.push(Object.freeze({ x, y, score }));
		}
	}
	return { candidates, maximumScore };
}
