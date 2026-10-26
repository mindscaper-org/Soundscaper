/* SPDX-License-Identifier: AGPL-3.0-only */

export interface Warp {
	readonly time: number;
	readonly contentTime: number;
}

/** Piecewise-linear content time at a warped time, extrapolating past the ends. */
export function warpValue(warps: readonly Warp[], time: number): number {
	const first = warps[0]!;
	const last = warps[warps.length - 1]!;
	if (time <= first.time) return interpolate(first, warps[1] ?? last, time);
	if (time >= last.time) return interpolate(warps[warps.length - 2] ?? first, last, time);
	for (let index = 1; index < warps.length; index += 1) {
		if (time <= warps[index]!.time) return interpolate(warps[index - 1]!, warps[index]!, time);
	}
	return last.contentTime;
}

export function warpInverse(warps: readonly Warp[], contentTime: number): number {
	const inverted = warps.map((warp) => ({ time: warp.contentTime, contentTime: warp.time }));
	return warpValue(inverted, contentTime);
}

function interpolate(from: Warp, to: Warp, time: number): number {
	const span = to.time - from.time;
	if (span === 0) return from.contentTime;
	return from.contentTime + (time - from.time) * (to.contentTime - from.contentTime) / span;
}
