/* SPDX-License-Identifier: AGPL-3.0-only */

import cyrillicExtUrl from '@fontsource/inter/files/inter-cyrillic-ext-600-normal.woff2';
import cyrillicUrl from '@fontsource/inter/files/inter-cyrillic-600-normal.woff2';
import latinExtUrl from '@fontsource/inter/files/inter-latin-ext-600-normal.woff2';
import latinUrl from '@fontsource/inter/files/inter-latin-600-normal.woff2';
import {
	VIDEO_BURN_IN_SIDE_MARGIN_FRACTION, videoBurnInFontSubsetIds,
	type VideoBurnInStage,
} from '../common/editor/video-caption-burn-in.ts';

const FONT_URLS: Readonly<Record<string, string>> = Object.freeze({
	'latin': latinUrl, 'latin-ext': latinExtUrl, 'cyrillic': cyrillicUrl, 'cyrillic-ext': cyrillicExtUrl,
});

export interface FramescaperCaptionRaster {
	draw(rgba: Uint8Array<ArrayBuffer>, seconds: number): void;
	dispose(): void;
}

/** Draw over the bottom band of the finished picture before either encoder reads it. */
export async function createFramescaperCaptionRaster(
	stage: VideoBurnInStage, width: number, height: number, signal: AbortSignal,
): Promise<FramescaperCaptionRaster> {
	const canvas = document.createElement('canvas');
	const { fontSizePx, lineSpacingPx, bottomMarginPx, boxBorderPx } = stage;
	const lineHeight = fontSizePx + lineSpacingPx;
	const cues = stage.cues.map((cue) => {
		const missing = new Set(cue.undrawable);
		const lines = Array.from(cue.text, (character) => missing.has(character) ? ' ' : character).join('').split('\n');
		return { ...cue, lines, height: lines.length * lineHeight + 2 * boxBorderPx };
	});
	canvas.width = width;
	canvas.height = Math.min(height, bottomMarginPx + maximumCaptionStackHeight(cues));
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('Caption burn-in needs a 2D drawing surface.');
	const fonts = await Promise.all(videoBurnInFontSubsetIds(stage).map(async (subset) => {
		const url = FONT_URLS[subset];
		if (!url) throw new RangeError(`No caption font subset named ${subset}.`);
		return new FontFace(fontFamily(subset), `url(${JSON.stringify(url)})`, { weight: '600' }).load();
	}));
	signal.throwIfAborted();
	const maxWidth = Math.max(1, width * (1 - 2 * VIDEO_BURN_IN_SIDE_MARGIN_FRACTION) - 2 * boxBorderPx);
	const rowBytes = width * 4;
	for (const font of fonts) document.fonts.add(font);
	context.textAlign = 'center';
	context.textBaseline = 'alphabetic';
	return {
		draw(rgba, seconds) {
			const active = cues.filter((cue) => seconds >= cue.startSeconds && seconds < cue.endSeconds);
			if (!active.length) return;
			const stackHeight = active.reduce((sum, cue) => sum + cue.height, 0);
			const bandHeight = Math.min(canvas.height, bottomMarginPx + stackHeight);
			const bandTop = canvas.height - bandHeight;
			const pixels = new Uint8ClampedArray(rgba.buffer,
				rgba.byteOffset + (height - bandHeight) * rowBytes, bandHeight * rowBytes);
			context.putImageData(new ImageData(pixels, width, bandHeight), 0, bandTop);
			let bottom = canvas.height - bottomMarginPx + boxBorderPx;
			for (let cueIndex = active.length - 1; cueIndex >= 0 && bottom > 0; cueIndex--) {
				const cue = active[cueIndex]!;
				const top = bottom - cue.height;
				context.font = `600 ${fontSizePx}px ${fontFamily(cue.fontSubset)}`;
				const widest = Math.min(maxWidth, Math.max(...cue.lines.map((line) => context.measureText(line).width)));
				context.fillStyle = 'rgba(0, 0, 0, 0.55)';
				context.fillRect((width - widest) / 2 - boxBorderPx, top, widest + 2 * boxBorderPx, cue.height);
				context.fillStyle = 'white';
				for (const [index, line] of cue.lines.entries()) {
					context.fillText(line, width / 2, top + boxBorderPx + fontSizePx + index * lineHeight, maxWidth);
				}
				bottom = top;
			}
			pixels.set(context.getImageData(0, bandTop, width, bandHeight).data);
		},
		dispose() {
			for (const font of fonts) document.fonts.delete(font);
			canvas.width = 0;
			canvas.height = 0;
		},
	};
}

function maximumCaptionStackHeight(cues: readonly { startSeconds: number; endSeconds: number; height: number }[]): number {
	const changes = cues.flatMap(({ startSeconds, endSeconds, height }) => [
		{ time: startSeconds, height }, { time: endSeconds, height: -height },
	]).sort((left, right) => left.time - right.time || left.height - right.height);
	let height = 0;
	let maximum = 0;
	for (const change of changes) {
		height += change.height;
		maximum = Math.max(maximum, height);
	}
	return maximum;
}

function fontFamily(subset: string): string {
	return `framescaper-captions-${subset}`;
}
