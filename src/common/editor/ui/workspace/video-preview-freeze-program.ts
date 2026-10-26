/* SPDX-License-Identifier: AGPL-3.0-only */

import { exactVideoPreviewRenderDimension } from '../video-preview-render-size.js';

export interface VideoPreviewFreezeFrame {
	readonly width: number;
	readonly height: number;
	readonly rgba: Uint8Array;
}

export interface VideoPreviewFreezeCompositor {
	render(layers: readonly unknown[], options: Readonly<Record<string, unknown>>): Readonly<{ status: unknown }>;
	captureEvaluatedRgba(): VideoPreviewFreezeFrame | null;
}

/** A permanent programme still must not inherit the panel's viewing resolution. */
export function captureVideoPreviewProgramFreezeFrame(input: Readonly<{
	readonly compositor: VideoPreviewFreezeCompositor;
	readonly layers: readonly unknown[];
	readonly options: Readonly<Record<string, unknown>>;
}>): VideoPreviewFreezeFrame {
	const width: number = exactVideoPreviewRenderDimension(input.options.referenceWidth, 'width');
	const height: number = exactVideoPreviewRenderDimension(input.options.referenceHeight, 'height');
	// Reuse the exact textures that produced the admitted preview. Uploading an
	// HTML video's current frame here could advance it beyond that playhead.
	const preview = { ...input.options, reusePresentedMedia: true };
	try {
		const report = input.compositor.render(input.layers, { ...preview, outputWidth: width, outputHeight: height });
		if (report.status === 'fallback') throw new Error('The programme freeze could not render every presented layer.');
		const frame = input.compositor.captureEvaluatedRgba();
		if (frame === null || frame.width !== width || frame.height !== height) {
			throw new Error('The programme freeze framebuffer is unavailable at its exact resolution.');
		}
		return frame;
	} finally {
		input.compositor.render(input.layers, preview);
	}
}
