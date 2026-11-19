/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	UnifiedExactRenderRgbaFrameV13,
} from './unified-exact-render-finishing-consumers-v13.ts';

/** Filter in premultiplied RGBA, returning straight RGB to the motion frame owner. */
export function sampleUnifiedExactRgbaChannelV13(
	frame: UnifiedExactRenderRgbaFrameV13,
	xValue: number,
	yValue: number,
	channel: number,
): number {
	const x = Math.max(0, Math.min(frame.width - 1, xValue));
	const y = Math.max(0, Math.min(frame.height - 1, yValue));
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const x1 = Math.min(frame.width - 1, x0 + 1);
	const y1 = Math.min(frame.height - 1, y0 + 1);
	const mixX = x - x0;
	const mixY = y - y0;
	const pixel = (px: number, py: number): number => {
		const offset = (py * frame.width + px) * 4;
		return frame.pixels[offset + channel]! * (channel === 3 ? 1 : frame.pixels[offset + 3]! / 255);
	};
	const top = pixel(x0, y0) + (pixel(x1, y0) - pixel(x0, y0)) * mixX;
	const bottom = pixel(x0, y1) + (pixel(x1, y1) - pixel(x0, y1)) * mixX;
	const value = top + (bottom - top) * mixY;
	if (channel === 3) return value;
	const alpha = sampleUnifiedExactRgbaChannelV13(frame, x, y, 3) / 255;
	return alpha === 0 ? 0 : value / alpha;
}

/** Write an in-bounds motion sample with shared taps and straight output color. */
export function writeUnifiedExactRgbaSampleV13(
	frame: UnifiedExactRenderRgbaFrameV13,
	x: number,
	y: number,
	target: Uint8Array,
	offset: number,
): void {
	const { width, height, pixels } = frame;
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const x1 = Math.min(width - 1, x0 + 1);
	const y1 = Math.min(height - 1, y0 + 1);
	const mixX = x - x0;
	const mixY = y - y0;
	const topLeft = (y0 * width + x0) * 4;
	const topRight = (y0 * width + x1) * 4;
	const bottomLeft = (y1 * width + x0) * 4;
	const bottomRight = (y1 * width + x1) * 4;
	const alphaTopLeft = pixels[topLeft + 3]!;
	const alphaTopRight = pixels[topRight + 3]!;
	const alphaBottomLeft = pixels[bottomLeft + 3]!;
	const alphaBottomRight = pixels[bottomRight + 3]!;
	const alphaByte = mixBilinear(alphaTopLeft, alphaTopRight, alphaBottomLeft, alphaBottomRight, mixX, mixY);
	target[offset + 3] = Math.round(alphaByte);
	const alpha = alphaByte / 255;
	if (alpha === 0) {
		target[offset] = 0;
		target[offset + 1] = 0;
		target[offset + 2] = 0;
		return;
	}
	const weightTopLeft = alphaTopLeft / 255;
	const weightTopRight = alphaTopRight / 255;
	const weightBottomLeft = alphaBottomLeft / 255;
	const weightBottomRight = alphaBottomRight / 255;
	for (let channel = 0; channel < 3; channel += 1) {
		const premultiplied = mixBilinear(
			pixels[topLeft + channel]! * weightTopLeft,
			pixels[topRight + channel]! * weightTopRight,
			pixels[bottomLeft + channel]! * weightBottomLeft,
			pixels[bottomRight + channel]! * weightBottomRight,
			mixX, mixY,
		);
		target[offset + channel] = Math.round(premultiplied / alpha);
	}
}

function mixBilinear(
	topLeft: number, topRight: number, bottomLeft: number, bottomRight: number, mixX: number, mixY: number,
): number {
	const top = topLeft + (topRight - topLeft) * mixX;
	const bottom = bottomLeft + (bottomRight - bottomLeft) * mixX;
	return top + (bottom - top) * mixY;
}
