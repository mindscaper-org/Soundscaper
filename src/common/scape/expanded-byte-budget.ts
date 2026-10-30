/* SPDX-License-Identifier: AGPL-3.0-only */

/** One cumulative counter for bytes actually emitted by every archive entry. */
export class ScapeExpandedByteBudget {
	readonly #maximumBytes: number;
	#usedBytes = 0;

	constructor(maximumBytes: number) {
		if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
			throw new RangeError('The Scape actual expanded-byte limit must be a positive safe integer.');
		}
		this.#maximumBytes = maximumBytes;
	}

	get maximumBytes(): number {
		return this.#maximumBytes;
	}

	get usedBytes(): number {
		return this.#usedBytes;
	}

	consume(byteLength: number, label: string): void {
		if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
			throw new RangeError(`The Scape entry ${label} emitted an invalid byte count.`);
		}
		if (byteLength > this.#maximumBytes - this.#usedBytes) {
			throw new RangeError('The Scape archive exceeds the cumulative actual expanded-byte limit.');
		}
		this.#usedBytes += byteLength;
	}
}
