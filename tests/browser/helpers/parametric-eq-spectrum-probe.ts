/* SPDX-License-Identifier: AGPL-3.0-only */

type NativeSpectrum = Readonly<{ rate: number; size: number; index: number; level: number }>;

/** Read the painted input peak and the existing native-analyser observation together. */
export function readParametricEqSpectrum(canvas: HTMLCanvasElement): {
	plot: { width: number; height: number; top: number; peakX: number };
	observed: NativeSpectrum | undefined;
} {
	const { width, height } = canvas;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('The spectrum probe requires a 2D canvas.');
	const pixels = context.getImageData(0, 0, width, height).data;
	let top = height, first = 0, last = 0;
	for (let x = 0; x < width; x += 1) {
		for (let y = 0; y < height; y += 1) {
			// A translucent narrow peak has only antialiased coverage near its tip.
			// Locate its first painted pixel instead of an arbitrary opacity contour.
			if (pixels[(y * width + x) * 4 + 3]! > 0) {
				if (y < top) { top = y; first = x; last = x; }
				else if (y === top) last = x;
				break;
			}
		}
	}
	return {
		plot: { width, height, top: top / height, peakX: (first + last) / 2 },
		observed: (window as Window & { __round6EqSpectrum?: NativeSpectrum }).__round6EqSpectrum,
	};
}
