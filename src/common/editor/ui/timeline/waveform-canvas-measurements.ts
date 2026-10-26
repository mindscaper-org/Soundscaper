/* SPDX-License-Identifier: AGPL-3.0-only */
import { snapshotWaveformCanvasStyle } from './canvas-paint-measurements.ts';

/** Normalize the whole row before any geometry reads or painter backing-store writes. */
export function readWaveformCanvasMeasurements(root: HTMLElement, normalize: (canvas: HTMLCanvasElement) => void) {
	const elements = root.querySelectorAll<HTMLElement>('[data-clip-id]');
	const canvases: { element: HTMLElement; canvas: HTMLCanvasElement }[] = [];
	for (const element of elements) {
		const canvas = element.querySelector<HTMLCanvasElement>('canvas.clip-body__waveform');
		if (canvas) { normalize(canvas); canvases.push({ element, canvas }); }
	}
	const result = [];
	for (const { element, canvas } of canvases) {
		const bounds = canvas.getBoundingClientRect();
		const color = canvas.closest<HTMLElement>('.clip-body')?.dataset.color || 'blue';
		result.push({ canvas, clipId: String(element.dataset.clipId), bounds, style: snapshotWaveformCanvasStyle(getComputedStyle(canvas), color) });
	}
	return result;
}
