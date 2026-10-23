/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoMaskCoordinateV1, VideoMaskPathV1 } from './video-mask-matte-v24.ts';

type Point = VideoMaskCoordinateV1;
interface Edge { readonly points: readonly [Point, Point, Point, Point]; readonly cuts: readonly number[] }
interface Crossing { readonly x: number; readonly winding: number }

/** Rasterize admitted cubic contours at pixel centres, with one bounded crossing walk per row. */
export function rasterizeVideoMaskPaths(
	paths: readonly VideoMaskPathV1[], fillRule: 'nonzero' | 'even-odd', width: number, height: number,
): Uint8Array<ArrayBuffer> {
	const edges = paths.flatMap(path => path.points.map((start, index) => {
		const end = path.points[(index + 1) % path.points.length]!;
		// Filling an open path closes it with a line, without connecting unused handles.
		const closing = !path.closed && index === path.points.length - 1;
		const points: readonly [Point, Point, Point, Point] = [start.position,
			closing ? start.position : start.outHandle ?? start.position,
			closing ? end.position : end.inHandle ?? end.position, end.position];
		return { points, cuts: monotoneCuts(points[0].y, points[1].y, points[2].y, points[3].y) };
	}));
	const output = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		const py = (y + 0.5) / height;
		const crossings: Crossing[] = [];
		for (const edge of edges) appendCrossings(edge, py, crossings);
		crossings.sort((left, right) => left.x - right.x);
		let winding = crossings.reduce((sum, crossing) => sum + crossing.winding, 0);
		let crossingIndex = 0;
		for (let x = 0; x < width; x++) {
			const px = (x + 0.5) / width;
			while (crossingIndex < crossings.length && crossings[crossingIndex]!.x <= px) {
				winding -= crossings[crossingIndex++]!.winding;
			}
			output[y * width + x] = (fillRule === 'even-odd' ? Math.abs(winding) % 2 === 1 : winding !== 0) ? 255 : 0;
		}
	}
	return output;
}

function appendCrossings(edge: Edge, y: number, crossings: Crossing[]): void {
	const [a, b, c, d] = edge.points;
	if (a.x === b.x && a.y === b.y && c.x === d.x && c.y === d.y) {
		if (a.y <= y && d.y > y) crossings.push({ x: a.x + (d.x - a.x) * (y - a.y) / (d.y - a.y), winding: 1 });
		else if (a.y > y && d.y <= y) crossings.push({ x: a.x + (d.x - a.x) * (y - a.y) / (d.y - a.y), winding: -1 });
		return;
	}
	for (let index = 1; index < edge.cuts.length; index++) {
		let low = edge.cuts[index - 1]!, high = edge.cuts[index]!;
		const left = cubic(a.y, b.y, c.y, d.y, low), right = cubic(a.y, b.y, c.y, d.y, high);
		const winding = left <= y && right > y ? 1 : left > y && right <= y ? -1 : 0;
		if (winding === 0) continue;
		// Each derivative-bounded interval is monotone. A fixed mantissa-sized
		// bisection avoids tolerance-dependent loops, including near-flat extrema.
		for (let turn = 0; turn < 53; turn++) {
			const middle = (low + high) / 2;
			if ((cubic(a.y, b.y, c.y, d.y, middle) <= y) === (winding > 0)) low = middle;
			else high = middle;
		}
		crossings.push({ x: cubic(a.x, b.x, c.x, d.x, (low + high) / 2), winding });
	}
}

function cubic(a: number, b: number, c: number, d: number, t: number): number {
	const inverse = 1 - t;
	return inverse * inverse * inverse * a + 3 * inverse * inverse * t * b
		+ 3 * inverse * t * t * c + t * t * t * d;
}

function monotoneCuts(a: number, b: number, c: number, d: number): readonly number[] {
	const quadratic = -a + 3 * b - 3 * c + d;
	const linear = 2 * (a - 2 * b + c);
	const constant = b - a;
	const roots: number[] = [];
	if (quadratic === 0) {
		if (linear !== 0) roots.push(-constant / linear);
	} else {
		const discriminant = linear * linear - 4 * quadratic * constant;
		if (discriminant >= 0) {
			const squareRoot = Math.sqrt(discriminant);
			// Avoid cancelling a small extremum against a much larger coefficient.
			const q = -0.5 * (linear + (linear < 0 ? -squareRoot : squareRoot));
			if (q !== 0) roots.push(q / quadratic, constant / q);
		}
	}
	return [0, ...new Set(roots.filter(value => value > 0 && value < 1).sort((left, right) => left - right)), 1];
}
