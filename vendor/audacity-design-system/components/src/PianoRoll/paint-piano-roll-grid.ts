/* SPDX-License-Identifier: AGPL-3.0-only */

import type { NoteGridCanvasProps } from './types';

type GridOptions = Pick<NoteGridCanvasProps, 'width' | 'height' | 'scrollX' | 'pixelsPerSecond' | 'bpm' | 'beatsPerMeasure' | 'snap' | 'musicalClock'>;
interface Colors { readonly gridMeasure: string; readonly gridBeat: string; readonly gridSubdivision: string; }

/** Keep painted source-time divisions on the same clock as note gestures. */
export function paintPianoRollGridLines(ctx: CanvasRenderingContext2D, options: GridOptions, pr: Colors): void {
 const { width, height, scrollX, pixelsPerSecond, bpm, beatsPerMeasure, snap, musicalClock } = options;
 if (musicalClock) {
  const start = scrollX / pixelsPerSecond, end = (scrollX + width) / pixelsPerSecond;
  const firstBeat = musicalClock.beatAtTime(start), lastBeat = musicalClock.beatAtTime(end);
  let divisions = snap.subdivision * (snap.triplet ? 1.5 : 1);
  while ((lastBeat - firstBeat) * divisions > 8192) divisions /= 2;
  let previousX = -Infinity;
  ctx.lineWidth = 1;
  for (let index = Math.ceil(firstBeat * divisions); index <= Math.floor(lastBeat * divisions); index++) {
   const x = musicalClock.timeAtBeat(index / divisions) * pixelsPerSecond - scrollX;
   if (x - previousX < 12) continue;
   previousX = x;
   ctx.strokeStyle = pr.gridSubdivision;
   ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  for (const tick of musicalClock.ticks(start, end, pixelsPerSecond)) {
   const x = tick.time * pixelsPerSecond - scrollX;
   ctx.strokeStyle = tick.bar ? pr.gridMeasure : pr.gridBeat;
   ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  return;
 }
 // Draw grid lines (vertical)
 const beatDuration = 60 / bpm;
 const measureDuration = beatDuration * beatsPerMeasure;
 const fullSubDivisions = snap.subdivision * (snap.triplet ? 1.5 : 1);

 // Reduce visible subdivisions when zoomed out so lines don't crowd
 const MIN_GRID_PX = 12; // Minimum pixels between grid lines
 let subDivisions = fullSubDivisions;
 while (subDivisions > 1 && (beatDuration / subDivisions) * pixelsPerSecond < MIN_GRID_PX) {
   subDivisions = Math.floor(subDivisions / 2) || 1;
 }
 const gridStep = beatDuration / subDivisions;

 const startTime = scrollX / pixelsPerSecond;
 const endTime = (scrollX + width) / pixelsPerSecond;

 const firstGrid = Math.floor(startTime / gridStep) * gridStep;
 for (let t = firstGrid; t <= endTime; t += gridStep) {
   const x = t * pixelsPerSecond - scrollX;
   if (x < 0) continue;

   const beat = t / beatDuration;
   const beatRound = Math.round(beat * 1000) / 1000;
   const isWholeBeat = Math.abs(beatRound - Math.round(beatRound)) < 0.001;
   const measure = t / measureDuration;
   if (Math.abs(measure - Math.round(measure)) < 0.000001) {
     ctx.strokeStyle = pr.gridMeasure;
   } else if (isWholeBeat) {
     ctx.strokeStyle = pr.gridBeat;
   } else {
     // Subdivision line
     ctx.strokeStyle = pr.gridSubdivision;
     ctx.lineWidth = 1;
   }

   ctx.beginPath();
   ctx.moveTo(x, 0);
   ctx.lineTo(x, height);
   ctx.stroke();
 }

 // A bar can start between visible snap divisions (for example 3/8 with
 // quarter-note snapping). Paint those boundaries once as well.
 const measureStride = Math.max(1, Math.ceil(1 / (measureDuration * pixelsPerSecond)));
 for (let measure = Math.ceil(startTime / (measureDuration * measureStride)) * measureStride;
   measure * measureDuration <= endTime; measure += measureStride) {
   const t = measure * measureDuration;
   const division = t / gridStep;
   if (Math.abs(division - Math.round(division)) < 0.000001) continue;
   const x = t * pixelsPerSecond - scrollX;
   ctx.strokeStyle = pr.gridMeasure;
   ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
 }
}
