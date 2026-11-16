/* SPDX-License-Identifier: AGPL-3.0-only */
import { TIMECODE_RATES, timecodeFromFrames, timecodeToFrames, wrapTimecodeFrame, type TimecodeRate, type TimecodeReading } from './timecode-sync-format.ts';

export function encodeMtcFullFrame(frame: number, rate: TimecodeRate): number[] {
	const fields = timecodeFromFrames(frame, rate);
	return [0xf0, 0x7f, 0x7f, 1, 1, fields.hours | (TIMECODE_RATES.indexOf(rate) << 5), fields.minutes, fields.seconds, fields.frames, 0xf7];
}
/** Eight data bytes; each must be preceded by system-common status F1. */
export function encodeMtcQuarterFrames(frame: number, rate: TimecodeRate): number[] {
	const fields = timecodeFromFrames(frame, rate);
	return [fields.frames & 15, 0x10 | (fields.frames >> 4), 0x20 | (fields.seconds & 15), 0x30 | (fields.seconds >> 4),
		0x40 | (fields.minutes & 15), 0x50 | (fields.minutes >> 4), 0x60 | (fields.hours & 15),
		0x70 | (fields.hours >> 4) | (TIMECODE_RATES.indexOf(rate) << 1)];
}

/** Bounded streaming parser. Realtime messages may interrupt either message kind. */
export class MtcDecoder {
	private sysex: number[] | null = null;
	private quarter = false;
	private nibbles = new Array<number>(8).fill(0);
	private count = 0;
	private previous = -1;
	private direction: -1 | 1 = 1;
	private lastTime = -Infinity;

	push(bytes: ArrayLike<number>, timestamp = 0): TimecodeReading[] {
		if (timestamp - this.lastTime > 250) this.count = 0;
		this.lastTime = timestamp;
		const readings: TimecodeReading[] = [];
		for (let index = 0; index < bytes.length; index += 1) {
			const byte = bytes[index];
			if (!Number.isInteger(byte) || byte < 0 || byte > 255 || byte >= 0xf8) continue;
			if (byte === 0xf0) { this.sysex = [byte]; this.quarter = false; this.count = 0; continue; }
			if (this.sysex) {
				if (byte === 0xf7) {
					const message = this.sysex; this.sysex = null;
					if (message.length === 9 && message[1] === 0x7f && message[3] === 1 && message[4] === 1 && message[5] < 128) {
						const rate = TIMECODE_RATES[message[5] >> 5];
						const frame = this.readFrame(message[5] & 31, message[6], message[7], message[8], rate);
						if (frame !== null) readings.push({ frame, rate, direction: 0 });
					}
					continue;
				}
				if (byte < 128 && this.sysex.length < 10) { this.sysex.push(byte); continue; }
				this.sysex = null;
			}
			if (byte === 0xf1) { this.quarter = true; continue; }
			if (byte >= 128) { this.quarter = false; continue; }
			if (!this.quarter) continue;
			this.quarter = false;
			const piece = byte >> 4;
			if (this.count && piece !== this.previous + this.direction) this.count = 0;
			if (!this.count) {
				if (piece !== 0 && piece !== 7) continue;
				this.direction = piece === 0 ? 1 : -1;
			}
			this.nibbles[piece] = byte & 15;
			this.previous = piece;
			this.count += 1;
			if (this.count !== 8) continue;
			this.count = 0;
			const n = this.nibbles;
			if (n[1] > 1 || n[3] > 3 || n[5] > 3 || n[7] > 7) continue;
			const rate = TIMECODE_RATES[n[7] >> 1];
			const frame = this.readFrame(n[6] | ((n[7] & 1) << 4), n[4] | (n[5] << 4), n[2] | (n[3] << 4), n[0] | (n[1] << 4), rate);
			if (frame !== null) readings.push({ frame: wrapTimecodeFrame(frame + 2 * this.direction, rate), rate, direction: this.direction });
		}
		return readings;
	}
	private readFrame(hours: number, minutes: number, seconds: number, frames: number, rate: TimecodeRate): number | null {
		try { return timecodeToFrames({ hours, minutes, seconds, frames }, rate); } catch { return null; }
	}
}
