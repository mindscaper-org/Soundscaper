/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Packed gain history for the Audacity NoiseReductionBase adaptation.
 * See spectral-noise-reduction.js for source and contributor attribution.
 */

/** Gain propagation decays from each open window, rounded to Float32 at every hop. */
export function createNoiseReductionGainEnvelope(windowCount: number, binCount: number,
	attenuation: number, releaseFactor: number, attackFactor: number, firstWindow: number) {
	// Each block stores 32 consecutive gate decisions in one word per bin.
	const openWindows = new Uint32Array(Math.ceil(windowCount / 32) * binCount);
	const previousOpen = new Int32Array(binCount).fill(-1);
	const nextOpen = new Int32Array(binCount).fill(-1);
	const floor = Math.fround(attenuation);
	const release = decaySteps(floor, releaseFactor, windowCount);
	const attack = decaySteps(floor, attackFactor, windowCount);
	const gains = new Float32Array(binCount);

	return {
		open(window: number, bin: number): void {
			const index = Math.floor(window / 32) * binCount + bin;
			openWindows[index] = openWindows[index]! | (1 << (window % 32));
			if (window < firstWindow) previousOpen[bin] = window;
		},
		/** Read consecutive windows starting at firstWindow, after all decisions are published. */
		read(window: number): Float32Array {
			const bit = 1 << (window % 32);
			const blockOffset = Math.floor(window / 32) * binCount;
			for (let bin = 0; bin < binCount; bin += 1) {
				if ((openWindows[blockOffset + bin]! & bit) !== 0) {
					gains[bin] = 1;
					previousOpen[bin] = window;
					continue;
				}
				let next = nextOpen[bin]!;
				if (next < window) {
					next = findNextOpen(openWindows, binCount, bin, window);
					nextOpen[bin] = next;
				}
				const previous = previousOpen[bin]!;
				const fromPrevious = previous < 0 ? floor : release[Math.min(window - previous, release.length - 1)]!;
				const fromNext = next === NO_OPEN_WINDOW ? floor : attack[Math.min(next - window, attack.length - 1)]!;
				gains[bin] = Math.max(fromPrevious, fromNext);
			}
			return gains;
		},
	};
}

const NO_OPEN_WINDOW = 0x7fff_ffff;

function findNextOpen(windows: Uint32Array, bins: number, bin: number, frame: number): number {
	let block = Math.floor(frame / 32);
	let index = block * bins + bin;
	let word = windows[index]! & (-1 << (frame % 32));
	while (word === 0) {
		index += bins;
		block += 1;
		if (index >= windows.length) return NO_OPEN_WINDOW;
		word = windows[index]!;
	}
	return block * 32 + 31 - Math.clz32(word & -word);
}

function decaySteps(floor: number, factor: number, frames: number): readonly number[] {
	const steps = [1];
	for (let index = 1; index < frames; index += 1) {
		const previous = steps[index - 1]!;
		const gain = Math.fround(Math.max(floor, previous * factor));
		if (gain === previous) break;
		steps.push(gain);
	}
	return steps;
}
