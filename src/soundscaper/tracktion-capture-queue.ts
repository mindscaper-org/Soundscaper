/* SPDX-License-Identifier: AGPL-3.0-only */

const capacity = 65_536;
const cursorBytes = 3 * Int32Array.BYTES_PER_ELEMENT;
const bufferBytes = cursorBytes + capacity * Float32Array.BYTES_PER_ELEMENT;
const writing = 1;
const sealed = 2;

/** One worklet writes the microphone stream and one Tracktion worker consumes it. */
export class TracktionCaptureQueue {
	readonly shared: SharedArrayBuffer;
	readonly #cursor: Int32Array;
	readonly #samples: Float32Array;

	constructor(shared = new SharedArrayBuffer(bufferBytes)) {
		if (shared.byteLength !== bufferBytes) throw new RangeError('Invalid Tracktion capture queue size');
		this.shared = shared;
		this.#cursor = new Int32Array(shared, 0, 3);
		this.#samples = new Float32Array(shared, cursorBytes);
	}

	/** Overflow seals the queue and preserves the contiguous prefix. */
	write(input: Float32Array): boolean {
		if (Atomics.compareExchange(this.#cursor, 2, 0, writing) !== 0) return true;
		const written = Atomics.load(this.#cursor, 0);
		const consumed = Atomics.load(this.#cursor, 1);
		const available = capacity - ((written - consumed) >>> 0);
		// Preserve the part of the quantum that still fits before reporting input loss.
		const count = Math.min(input.length, available);
		for (let index = 0; index < count; index += 1) {
			this.#samples[(written + index) & (capacity - 1)] = input[index];
		}
		Atomics.store(this.#cursor, 0, written + count);
		if (count !== input.length) this.seal();
		Atomics.and(this.#cursor, 2, ~writing);
		return count === input.length;
	}

	seal(): void { Atomics.or(this.#cursor, 2, sealed); }
	get sealed(): boolean { return Atomics.load(this.#cursor, 2) === sealed; }

	readableFrames(): number {
		const consumed = Atomics.load(this.#cursor, 1);
		return (Atomics.load(this.#cursor, 0) - consumed) >>> 0;
	}

	/** Advance the cursor only after the native callback has accepted these frames. */
	peek(target: Float32Array, count: number): void {
		const consumed = Atomics.load(this.#cursor, 1);
		for (let index = 0; index < count; index += 1) {
			target[index] = this.#samples[(consumed + index) & (capacity - 1)];
		}
	}

	consume(count: number): void { Atomics.add(this.#cursor, 1, count); }
}
