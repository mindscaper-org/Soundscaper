/* SPDX-License-Identifier: AGPL-3.0-only */

/** Input lookahead for the bounded, output-clock antialias window. */
export function defaultWindowedSincRadius(inputRate: number, outputRate: number): number {
	return Math.max(24, Math.min(4096, Math.ceil(24 * inputRate / outputRate)));
}
