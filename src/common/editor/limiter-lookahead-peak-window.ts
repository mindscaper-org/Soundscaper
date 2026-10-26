/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep every future detector peak until its delayed programme sample is emitted.
 * A monotone queue needs fixed storage and amortized constant work per sample.
 */
export class LimiterLookaheadPeakWindow {
	private readonly peaks: Float64Array;
	private readonly positions: Uint32Array;
	private head = 0;
	private size = 0;
	private cursor = 0;

	constructor(lookaheadFrames: number) {
		if (!Number.isSafeInteger(lookaheadFrames) || lookaheadFrames < 0) throw new RangeError('Invalid limiter lookahead.');
		this.peaks = new Float64Array(lookaheadFrames + 1);
		this.positions = new Uint32Array(lookaheadFrames + 1);
	}

	reset(): void { this.head = 0; this.size = 0; this.cursor = 0; }

	push(peak: number): number {
		const capacity = this.peaks.length;
		if (this.size && this.positions[this.head] === this.cursor) {
			this.head = (this.head + 1) % capacity;
			this.size--;
		}
		while (this.size && this.peaks[(this.head + this.size - 1) % capacity]! <= peak) this.size--;
		const tail = (this.head + this.size) % capacity;
		this.peaks[tail] = peak;
		this.positions[tail] = this.cursor;
		this.size++;
		this.cursor = (this.cursor + 1) % capacity;
		return this.peaks[this.head]!;
	}
}

export function limiterLookaheadPeakWindowBytes(lookaheadFrames: number): number {
	return (lookaheadFrames + 1) * (Float64Array.BYTES_PER_ELEMENT + Uint32Array.BYTES_PER_ELEMENT);
}
