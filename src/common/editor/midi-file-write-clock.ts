/* SPDX-License-Identifier: AGPL-3.0-only */
import { midiFileInteger, type MidiFileTempo } from './midi-file-types.ts';
import { roundRational } from './timeline-time.ts';

interface Segment {
	readonly tick: number;
	readonly frameNumerator: bigint;
	readonly sampleMicros: bigint;
}

/** Each tempo starts at its emitted tick, whose sample position may be fractional. */
export function createMidiFileWriteClock(tempos: readonly MidiFileTempo[], sampleRate: number, division: number) {
	const frameDenominator = BigInt(division) * 1_000_000n;
	const rate = BigInt(sampleRate);
	const segments: Segment[] = [{ tick: 0, frameNumerator: 0n, sampleMicros: 500_000n * rate }];
	const writtenTempos = [...tempos].sort((left, right) => left.frame - right.frame).map(tempo => {
		const micros = midiFileInteger(Math.round(60_000_000 / tempo.bpm), 1, 0xffffff, 'tempo');
		const previous = segments[segments.length - 1]!;
		const delta = roundRational(BigInt(tempo.frame) * frameDenominator - previous.frameNumerator, previous.sampleMicros, 'point');
		const tick = Math.max(previous.tick, previous.tick + delta);
		const frameNumerator = previous.frameNumerator + BigInt(tick - previous.tick) * previous.sampleMicros;
		segments.push({ tick, frameNumerator, sampleMicros: BigInt(micros) * rate });
		return { tick, micros };
	});
	return {
		tempos: writtenTempos,
		tick(frame: number): number {
			const numerator = BigInt(frame) * frameDenominator;
			let low = 0, high = segments.length;
			while (low + 1 < high) {
				const middle = Math.floor((low + high) / 2);
				if (segments[middle]!.frameNumerator <= numerator) low = middle;
				else high = middle;
			}
			const segment = segments[low]!;
			return segment.tick + roundRational(numerator - segment.frameNumerator, segment.sampleMicros, 'point');
		},
	};
}
