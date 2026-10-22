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
