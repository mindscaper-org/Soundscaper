/* SPDX-License-Identifier: AGPL-3.0-only */
import { timecodeFromFrames, timecodeRate, timecodeToFrames, type TimecodeRate } from './timecode-sync-format.ts';

// SMPTE ST 12-1, tables 2, 3 and 5. Bits are stored in transmission order.
const SYNC = [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1];
const DIGITS = [[0, 4], [8, 2], [16, 4], [24, 3], [32, 4], [40, 3], [48, 4], [56, 2]];

export function encodeLtcFrame(frame: number, rate: TimecodeRate): Uint8Array {
	const fields = timecodeFromFrames(frame, rate);
	const values = [fields.frames, fields.seconds, fields.minutes, fields.hours].flatMap(value => [value % 10, Math.floor(value / 10)]);
	const bits = new Uint8Array(80);
	DIGITS.forEach(([start, width], index) => {
		for (let bit = 0; bit < width; bit += 1) bits[start + bit] = (values[index] >> bit) & 1;
	});
	bits[10] = rate === '29.97df' ? 1 : 0;
	bits.set(SYNC, 64);
	bits[rate === '25' ? 59 : 27] = bits.reduce((parity, bit) => parity ^ bit, 0);
	return bits;
}

export function decodeLtcFrame(bits: Uint8Array, rate: TimecodeRate): number | null {
	if (bits.length !== 80 || !SYNC.every((bit, index) => bits[64 + index] === bit)) return null;
	if ((rate === '30' || rate === '29.97df') && bits[10] !== (rate === '29.97df' ? 1 : 0)) return null;
	const digits = DIGITS.map(([start, width]) => {
		let value = 0;
		for (let bit = 0; bit < width; bit += 1) value |= bits[start + bit] << bit;
		return value;
	});
	if (digits.some((digit, index) => index % 2 === 0 && digit > 9)) return null;
	try {
		return timecodeToFrames({ frames: digits[0] + 10 * digits[1], seconds: digits[2] + 10 * digits[3],
			minutes: digits[4] + 10 * digits[5], hours: digits[6] + 10 * digits[7] }, rate);
	} catch { return null; }
}

/** Fractional half-bit boundaries derive from an absolute sample clock, avoiding per-frame drift. */
export class LtcEncoder {
	private sample = 0;
	private origin = 0;
	private previousHalf = -1;
	private polarity = 0.25;
	private bits: Uint8Array = new Uint8Array(80);
	constructor(private readonly sampleRate: number, private readonly rate: TimecodeRate, private readonly speed = 1) {}
	seek(frame: number, offsetSamples = 0): void {
		this.origin = frame; this.sample = offsetSamples; this.previousHalf = -1; this.polarity = 0.25;
	}
	write(output: Float32Array): void {
		const halfBitsPerSample = timecodeRate(this.rate) * 160 * this.speed / this.sampleRate;
		for (let index = 0; index < output.length; index += 1) {
			const half = Math.floor(this.sample++ * halfBitsPerSample);
			if (half !== this.previousHalf) {
				if (half % 160 === 0 || this.previousHalf < 0) this.bits = encodeLtcFrame(this.origin + Math.floor(half / 160), this.rate);
				if (half % 2 === 0 || this.bits[Math.floor(half / 2) % 80]) this.polarity = -this.polarity;
				this.previousHalf = half;
			}
			output[index] = this.polarity;
		}
	}
}

export interface LtcReading { readonly frame: number; readonly direction: -1 | 1; readonly sample: number }

/** Schmitt edge detector and biphase decoder, retaining only one 80-bit window. */
export class LtcDecoder {
	private sample = 0;
	private lastEdge = -1;
	private polarity = 0;
	private short = false;
	private count = 0;
	private bits = new Uint8Array(80);
	private halfPeriod: number;
	constructor(sampleRate: number, private readonly rate: TimecodeRate) {
		this.halfPeriod = sampleRate / (timecodeRate(rate) * 160);
	}
	push(input: Float32Array): LtcReading[] {
		const readings: LtcReading[] = [];
		for (const amplitude of input) {
			const sample = this.sample++;
			const polarity = amplitude > 0.005 ? 1 : amplitude < -0.005 ? -1 : this.polarity;
			if (!polarity || polarity === this.polarity) continue;
			this.polarity = polarity;
			const duration = sample - this.lastEdge;
			const hadEdge = this.lastEdge >= 0;
			this.lastEdge = sample;
			if (!hadEdge) continue;
			if (duration < this.halfPeriod * 0.5 || duration > this.halfPeriod * 2.6) {
				this.short = false; this.count = 0; continue;
			}
			let bit: number;
			if (duration < this.halfPeriod * 1.5) {
				this.short = !this.short;
				if (this.short) continue;
				bit = 1;
			} else { this.short = false; bit = 0; }
			this.bits.copyWithin(0, 1); this.bits[79] = bit;
			this.count = Math.min(80, this.count + 1);
			if (this.count !== 80) continue;
			let frame = decodeLtcFrame(this.bits, this.rate);
			if (frame !== null) { readings.push({ frame, direction: 1, sample }); continue; }
			if (SYNC.every((value, index) => this.bits[15 - index] === value)) {
				frame = decodeLtcFrame(this.bits.slice().reverse(), this.rate);
				if (frame !== null) readings.push({ frame, direction: -1, sample });
			}
		}
		return readings;
	}
}
