/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionPreviewFrame } from './motion-preview-types.ts';

type Canvas = Pick<HTMLCanvasElement, 'width' | 'height'>;
type Context = Pick<CanvasRenderingContext2D, 'putImageData'>;
type Frame = Pick<MotionPreviewFrame, 'width' | 'height' | 'rgba'>;

/** One private sRGB upload image per geometry; published and cached frame bytes remain owned by their source. */
export function createMotionPreviewCanvasUpload() {
	let image: ImageData | null = null; let disposed = false;
	return {
		paint(canvas: Canvas, context: Context, frame: Frame): void {
			if (disposed) throw new Error('Motion preview canvas upload is disposed.');
			const bytes = frame.width * frame.height * 4;
			if (!Number.isSafeInteger(frame.width) || !Number.isSafeInteger(frame.height) || frame.width < 1 || frame.height < 1
				|| !Number.isSafeInteger(bytes) || !(frame.rgba instanceof Uint8ClampedArray) || frame.rgba.length !== bytes) {
				throw new RangeError('Motion preview frame dimensions or pixels are invalid.');
			}
			if (!image || image.width !== frame.width || image.height !== frame.height) {
				image = new ImageData(new Uint8ClampedArray(bytes), frame.width, frame.height);
			}
			image.data.set(frame.rgba);
			if (canvas.width !== frame.width) canvas.width = frame.width;
			if (canvas.height !== frame.height) canvas.height = frame.height;
			context.putImageData(image, 0, 0);
		},
		dispose(): void { disposed = true; image = null; },
	};
}
