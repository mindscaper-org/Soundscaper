/* SPDX-License-Identifier: AGPL-3.0-only */

import { createTimelineSpectrogramCache } from '../../controller/source/timeline-spectrogram-cache.ts';

interface SelectionLayers { base: HTMLCanvasElement | null; selected: HTMLCanvasElement | null; edges: HTMLCanvasElement | null; }
interface ColumnRange { readonly start: number; readonly end: number; }

const cache = createTimelineSpectrogramCache<SelectionLayers>({
	releaseImage(layers) {
		if (layers.base) { layers.base.width = 0; layers.base.height = 0; }
		if (layers.selected) { layers.selected.width = 0; layers.selected.height = 0; }
		if (layers.edges) { layers.edges.width = 0; layers.edges.height = 0; }
	},
});

export function releaseWaveformSelectionLayers(owner: object) { cache.release(owner); }

/** Copy complete columns; redraw the selection edges on the backing-pixel grid. */
export function paintWaveformSelectionLayers(context: CanvasRenderingContext2D, options: Readonly<{
	key: readonly unknown[];
	width: number;
	start: number;
	end: number;
	draw(surface: HTMLCanvasElement, selected: boolean): boolean;
	drawEdges(surface: HTMLCanvasElement, ranges: readonly ColumnRange[]): boolean;
}>): boolean {
	const owner = context.canvas;
	if (!owner) return false;
	if (!(options.width > 0) || !Number.isFinite(options.width) || !(owner.width > 0) || !owner.ownerDocument || typeof context.drawImage !== 'function') {
		cache.release(owner); return false;
	}
	const ratio = owner.width / options.width;
	const toPixel = (column: number) => Math.max(0, Math.min(owner.width, Math.round(column * ratio)));
	const selected = options.end > options.start;
	const start = selected ? toPixel(Math.ceil(options.start)) : 0;
	const end = selected ? toPixel(Math.floor(options.end)) : 0;
	const wholeSelection = selected && options.start <= 0 && options.end >= options.width;
	const make = (selected: boolean) => {
		const surface = owner.ownerDocument.createElement('canvas');
		surface.width = owner.width; surface.height = owner.height;
		try { if (options.draw(surface, selected)) return surface; }
		catch (error) { surface.width = 0; surface.height = 0; throw error; }
		surface.width = 0; surface.height = 0; return null;
	};
	// Reserve all three surfaces, including the lazily allocated edge scratch.
	const layers = cache.image(owner, options.key, owner.width * 3, owner.height, () => {
		const image = make(wholeSelection);
		return image ? { base: wholeSelection ? null : image, selected: wholeSelection ? image : null, edges: null } : null;
	});
	if (!layers) return false;
	if (!wholeSelection && !layers.base) layers.base = make(false);
	if (end > start && !layers.selected) layers.selected = make(true);
	const dominantImage = wholeSelection ? layers.selected : layers.base;
	if (!dominantImage || (end > start && !layers.selected)) return false;
	context.save();
	try {
	context.setTransform(1, 0, 0, 1, 0, 0);
	context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
	context.clearRect(0, 0, owner.width, owner.height);
	context.drawImage(dominantImage, 0, 0);
	if (!wholeSelection && end > start && layers.selected) {
		context.clearRect(start, 0, end - start, owner.height);
		context.drawImage(layers.selected, start, 0, end - start, owner.height, start, 0, end - start, owner.height);
	}
	const edgeColumns = new Set<number>();
	if (selected && !wholeSelection) for (const edge of [options.start, options.end]) {
		if (Number.isInteger(edge) && Number.isInteger(edge * ratio)) continue;
		const column = Math.floor(edge);
		// At fractional scales a background edge can occupy a neighbour's rounded
		// waveform pixel. Include both neighbours so clearing cannot leave a seam.
		const margin = Number.isInteger(ratio) ? 0 : Math.ceil(0.5 / ratio);
		for (let x = column - margin; x <= column + margin; x++) edgeColumns.add(x);
	}
	const ranges = [...edgeColumns].filter(column => column >= 0 && column < options.width).map(column => ({ start: column, end: column + 1 }));
	if (ranges.length) {
		if (!layers.edges) {
			layers.edges = owner.ownerDocument.createElement('canvas');
			layers.edges.width = owner.width; layers.edges.height = owner.height;
		}
		// Native clipping changes fractional alpha rounding on some rasterizers.
		// Paint edges without an extra clip, then copy complete backing pixels.
		if (!options.drawEdges(layers.edges, ranges)) return false;
		for (const range of ranges) {
			const left = toPixel(range.start);
			const width = toPixel(range.end) - left;
			if (!width) continue;
			context.clearRect(left, 0, width, owner.height);
			context.drawImage(layers.edges, left, 0, width, owner.height, left, 0, width, owner.height);
		}
	}
	} finally { context.restore(); }
	return true;
}
