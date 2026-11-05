/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PianoRollRulerProps } from './types';

type Options = Omit<PianoRollRulerProps, 'snap' | 'timeBasis'> & { readonly height: number };
interface Colors { readonly lineColor: string; readonly textColor: string; readonly tickColor: string; }

export function paintPianoRollRulerTicks(ctx: CanvasRenderingContext2D, options: Options, colors: Colors): void {
	const { width, height, scrollX, pixelsPerSecond, bpm, beatsPerMeasure, musicalClock } = options;
	const { lineColor, textColor, tickColor } = colors;
	const midHeight = Math.floor(height / 2);
	ctx.font = '11px system-ui, sans-serif';
	ctx.lineWidth = 1;
	const paint = (time: number, bar: boolean, label: string) => {
		const x = time * pixelsPerSecond - scrollX;
		if (x < 0 || x > width) return;
		const tickX = Math.floor(x) + .5;
		ctx.strokeStyle = bar ? lineColor : tickColor;
		if (bar) {
			ctx.beginPath(); ctx.moveTo(tickX, 0); ctx.lineTo(tickX, midHeight); ctx.stroke();
			ctx.beginPath(); ctx.moveTo(tickX, midHeight); ctx.lineTo(tickX, height); ctx.stroke();
		} else {
			ctx.beginPath(); ctx.moveTo(tickX, height - (height - midHeight) * .4); ctx.lineTo(tickX, height); ctx.stroke();
		}
		ctx.fillStyle = bar ? textColor : tickColor;
		if (label) ctx.fillText(label, x + 4, midHeight / 2 + 4);
	};
	if (musicalClock) {
		const ticks = musicalClock.ticks(scrollX / pixelsPerSecond, (scrollX + width) / pixelsPerSecond, pixelsPerSecond);
		for (const [index, tick] of ticks.entries()) {
			const neighbor = ticks[index + 1] ?? ticks[index - 1];
			const show = tick.bar || !neighbor || Math.abs(neighbor.time - tick.time) * pixelsPerSecond >= 32;
			paint(tick.time, tick.bar, show ? tick.label : '');
		}
		return;
	}
	const secondsPerBeat = 60 / bpm, secondsPerMeasure = secondsPerBeat * beatsPerMeasure;
	const first = Math.floor(scrollX / pixelsPerSecond / secondsPerMeasure);
	const last = Math.ceil((scrollX + width) / pixelsPerSecond / secondsPerMeasure);
	const showBeats = secondsPerBeat * pixelsPerSecond >= 32;
	for (let measure = first; measure <= last; measure++) for (let beat = 0; beat < beatsPerMeasure; beat++) {
		if (!showBeats && beat !== 0) continue;
		paint(measure * secondsPerMeasure + beat * secondsPerBeat, beat === 0,
			beat === 0 ? `${measure + 1}` : `${measure + 1}.${beat + 1}`);
	}
}
