/* SPDX-License-Identifier: AGPL-3.0-only */

import { boundedCanvasDimensions } from '../../design-system-adapters/canvas.ts';
import type { TimelineMidiNotePreview } from './timeline-midi-notes.ts';

interface MidiNoteCanvasOptions {
	readonly bounds: Pick<DOMRectReadOnly, 'width' | 'height'>;
	readonly palette: Pick<CSSStyleDeclaration, 'getPropertyValue'>;
	readonly color: string;
	readonly selection: Readonly<{ start: number; end: number }>;
}

export function drawMidiNoteCanvas(canvas: HTMLCanvasElement, preview: TimelineMidiNotePreview,
	{ bounds: { width, height }, palette, color, selection }: MidiNoteCanvasOptions): boolean {
	const context = canvas.getContext('2d', { alpha: true });
	if (!context || width <= 0 || height <= 0 || preview.windowLength <= 0) return false;
	const dimensions = boundedCanvasDimensions(Math.max(1, width), Math.max(1, height), {
		devicePixelRatio: canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1,
		maximumBackingHeight: 2_048,
	});
	if (canvas.width !== dimensions.backingWidth) canvas.width = dimensions.backingWidth;
	if (canvas.height !== dimensions.backingHeight) canvas.height = dimensions.backingHeight;
	const baseColor = palette.getPropertyValue(`--clip-${color}-waveform`).trim() || '#172533';
	const scaleX = canvas.width / width;
	const scaleY = canvas.height / height;
	context.save();
	context.setTransform(1, 0, 0, 1, 0, 0);
	context.globalAlpha = 1;
	context.globalCompositeOperation = 'source-over';
	context.clearRect(0, 0, canvas.width, canvas.height);
	context.fillStyle = baseColor;
	if (preview.spans.length) paintMidiNotes(context, preview, scaleY);
	if (selection.end > selection.start) {
		const x = selection.start * scaleX;
		const selectedWidth = (selection.end - selection.start) * scaleX;
		context.globalCompositeOperation = 'source-atop';
		context.fillStyle = palette.getPropertyValue(`--clip-${color}-time-selection-waveform`).trim() || baseColor;
		context.fillRect(x, 0, selectedWidth, canvas.height);
		context.globalCompositeOperation = 'destination-over';
		context.fillStyle = palette.getPropertyValue(`--clip-${color}-time-selection-body`).trim() || 'rgba(255, 255, 255, 0.15)';
		context.fillRect(x, 0, selectedWidth, canvas.height);
	}
	context.restore();
	return true;
}

function paintMidiNotes(context: CanvasRenderingContext2D, preview: TimelineMidiNotePreview, scaleY: number): void {
	const { period, windowStart, windowLength } = preview;
	if (period !== null && period < windowLength) {
		// Rasterize one period. Even a zoomed-out clip with millions of repeats
		// takes one bounded tile and a single pattern fill.
		const periodWidth = Math.max(1, period / windowLength * context.canvas.width);
		const tile = context.canvas.ownerDocument.createElement('canvas');
		tile.width = Math.ceil(periodWidth);
		tile.height = context.canvas.height;
		const tileContext = tile.getContext('2d');
		if (!tileContext) return;
		tileContext.fillStyle = context.fillStyle;
		paintNoteSpans(tileContext, preview, 0, period, scaleY);
		const pattern = context.createPattern(tile, 'repeat-x');
		if (!pattern) return;
		pattern.setTransform({ a: periodWidth / tile.width, e: -windowStart / period * periodWidth });
		context.fillStyle = pattern;
		context.fillRect(0, 0, context.canvas.width, context.canvas.height);
		return;
	}
	paintNoteSpans(context, preview, windowStart, windowLength, scaleY);
	if (period !== null && windowStart + windowLength > period) {
		paintNoteSpans(context, preview, windowStart - period, windowLength, scaleY);
	}
}

function paintNoteSpans(context: CanvasRenderingContext2D, preview: TimelineMidiNotePreview,
	start: number, length: number, scaleY: number): void {
	const { width, height } = context.canvas;
	const end = start + length;
	const scaleX = width / length;
	const rowStep = height / Math.max(12, preview.pitchMax - preview.pitchMin + 3);
	const centerPitch = (preview.pitchMin + preview.pitchMax) / 2;
	const barHeight = Math.max(1, Math.floor(Math.min(6 * scaleY, rowStep * 0.7)));
	for (const span of preview.spans) {
		if (span.end <= start || span.start >= end) continue;
		const x = Math.floor((Math.max(start, span.start) - start) * scaleX);
		const right = Math.ceil((Math.min(end, span.end) - start) * scaleX);
		const y = Math.floor(height / 2 + (centerPitch - span.pitch) * rowStep - barHeight / 2);
		context.fillRect(x, y, Math.max(1, right - x), barHeight);
	}
}
