/* SPDX-License-Identifier: AGPL-3.0-only */

export const TRACKTION_BLOCK_FRAMES = 128;
export type TracktionAudioBuffers = Readonly<{ output: SharedArrayBuffer; capture?: SharedArrayBuffer }>;

const capacity = 2048;
const cursorBytes = 2 * Int32Array.BYTES_PER_ELEMENT;
const bufferBytes = cursorBytes + capacity * 2 * Float32Array.BYTES_PER_ELEMENT;

/** One audio producer and one consumer share interleaved stereo samples. */
export class TracktionAudioQueue {
	readonly shared: SharedArrayBuffer;
	readonly #cursor: Int32Array;
	readonly #samples: Float32Array;

	constructor(shared = new SharedArrayBuffer(bufferBytes)) {
		if (shared.byteLength !== bufferBytes) throw new RangeError('Invalid Tracktion audio queue size');
		this.shared = shared;
		this.#cursor = new Int32Array(shared, 0, 2);
		this.#samples = new Float32Array(shared, cursorBytes);
	}

	writableBlocks(): number {
		const written = Atomics.load(this.#cursor, 0);
		const consumed = Atomics.load(this.#cursor, 1);
		return Math.floor((capacity - ((written - consumed) >>> 0)) / TRACKTION_BLOCK_FRAMES);
	}

	writeBlock(planar: Float32Array): void {
		const written = Atomics.load(this.#cursor, 0);
		for (let index = 0; index < TRACKTION_BLOCK_FRAMES; index += 1) {
			const frame = ((written + index) & (capacity - 1)) * 2;
			this.#samples[frame] = planar[index];
			this.#samples[frame + 1] = planar[index + TRACKTION_BLOCK_FRAMES];
		}
		Atomics.store(this.#cursor, 0, written + TRACKTION_BLOCK_FRAMES);
	}

	read(left: Float32Array, right: Float32Array): void {
		const consumed = Atomics.load(this.#cursor, 1);
		const written = Atomics.load(this.#cursor, 0);
		const count = Math.min(left.length, right.length, (written - consumed) >>> 0);
		for (let index = 0; index < count; index += 1) {
			const frame = ((consumed + index) & (capacity - 1)) * 2;
			left[index] = this.#samples[frame];
			right[index] = this.#samples[frame + 1];
		}
		left.fill(0, count);
		right.fill(0, count);
		Atomics.store(this.#cursor, 1, consumed + count);
	}
}
