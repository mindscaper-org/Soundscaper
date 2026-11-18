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
		return { ...cue, lines };
	});
	const lines = Math.max(...cues.map((cue) => cue.lines.length));
	canvas.width = width;
	canvas.height = Math.min(height, bottomMarginPx + lines * lineHeight + 2 * boxBorderPx);
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('Caption burn-in needs a 2D drawing surface.');
	const fonts = await Promise.all(videoBurnInFontSubsetIds(stage).map(async (subset) => {
		const url = FONT_URLS[subset];
		if (!url) throw new RangeError(`No caption font subset named ${subset}.`);
		return new FontFace(fontFamily(subset), `url(${JSON.stringify(url)})`, { weight: '600' }).load();
	}));
	signal.throwIfAborted();
	const maxWidth = Math.max(1, width * (1 - 2 * VIDEO_BURN_IN_SIDE_MARGIN_FRACTION) - 2 * boxBorderPx);
	const bandByteOffset = (height - canvas.height) * width * 4;
	const bandByteLength = canvas.height * width * 4;
	for (const font of fonts) document.fonts.add(font);
	context.textAlign = 'center';
	context.textBaseline = 'alphabetic';
	return {
		draw(rgba, seconds) {
			const active = cues.filter((cue) => seconds >= cue.startSeconds && seconds < cue.endSeconds);
			if (!active.length) return;
			const pixels = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset + bandByteOffset, bandByteLength);
			context.putImageData(new ImageData(pixels, width, canvas.height), 0, 0);
			for (const cue of active) {
				const textHeight = cue.lines.length * lineHeight;
				const top = canvas.height - bottomMarginPx - textHeight;
				context.font = `600 ${fontSizePx}px ${fontFamily(cue.fontSubset)}`;
				const widest = Math.min(maxWidth, Math.max(...cue.lines.map((line) => context.measureText(line).width)));
				context.fillStyle = 'rgba(0, 0, 0, 0.55)';
				context.fillRect((width - widest) / 2 - boxBorderPx, top - boxBorderPx,
					widest + 2 * boxBorderPx, textHeight + 2 * boxBorderPx);
				context.fillStyle = 'white';
				for (const [index, line] of cue.lines.entries()) {
					context.fillText(line, width / 2, top + fontSizePx + index * lineHeight, maxWidth);
				}
			}
			pixels.set(context.getImageData(0, 0, width, canvas.height).data);
		},
		dispose() {
			for (const font of fonts) document.fonts.delete(font);
			canvas.width = 0;
			canvas.height = 0;
		},
	};
}

function fontFamily(subset: string): string {
	return `framescaper-captions-${subset}`;
}
