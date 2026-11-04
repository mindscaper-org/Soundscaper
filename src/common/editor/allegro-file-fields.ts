/* SPDX-License-Identifier: AGPL-3.0-only */

import type { createMidiTempoTimeline } from './midi-file-timing.ts';

type TempoTimeline = ReturnType<typeof createMidiTempoTimeline>;
const PITCH_CLASSES: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DURATIONS: Readonly<Record<string, number>> = { S: 0.25, I: 0.5, Q: 1, H: 2, W: 4 };
const DYNAMICS: Readonly<Record<string, number>> = { PPP: 60, PP: 70, P: 80, MP: 90, MF: 100, F: 110, FF: 120, FFF: 127 };

export function allegroTokens(line: string): string[] {
	const tokens: string[] = [];
	let token = '';
	let quote = '';
	let escaped = false;
	for (const char of line) {
		if (quote) {
			token += char;
			if (escaped) escaped = false;
			else if (char === '\\') escaped = true;
			else if (char === quote) quote = '';
		} else if (char === '"' || char === "'") { quote = char; token += char; }
		else if (char === '#') break;
		else if (/\s/.test(char)) { if (token) tokens.push(token); token = ''; }
		else token += char;
	}
	if (quote) throw new RangeError('Unterminated Allegro quoted value.');
	if (token) tokens.push(token);
	return tokens;
}

export function allegroNumber(value: string, name: string): number {
	if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) throw new RangeError(`Invalid Allegro ${name}.`);
	const number = Number(value);
	if (!Number.isFinite(number)) throw new RangeError(`Invalid Allegro ${name}.`);
	return number;
}

/** Current PortSMF numeric T/U units are seconds; beat durations use SIQHW. */
export function allegroDuration(value: string, frame: number, timing: TempoTimeline, sampleRate: number): number {
	const terms = value.split('+');
	let duration = 0;
	for (const term of terms) {
		if (/^[\d.-]/.test(term)) {
			const seconds = allegroNumber(term, 'duration');
			if (seconds < 0) throw new RangeError('Allegro duration cannot be negative.');
			duration += seconds * sampleRate;
			continue;
		}
		const match = /^([SIQHW])([.T]*)(\d+(?:\.\d*)?)?(?:\/(\d+(?:\.\d*)?))?$/i.exec(term);
		if (!match) throw new RangeError(`Invalid Allegro duration: ${term}.`);
		const modifier = match[2]!.toUpperCase();
		const dots = [...modifier].filter(char => char === '.').length;
		const triplets = [...modifier].filter(char => char === 'T').length;
		const divisor = match[4] ? allegroNumber(match[4], 'duration divisor') : 1;
		if (!divisor) throw new RangeError('Allegro duration divisor cannot be zero.');
		const beats = DURATIONS[match[1]!.toUpperCase()]! * (2 - 2 ** -dots) * (2 / 3) ** triplets
			* (match[3] ? allegroNumber(match[3], 'duration multiplier') : 1) / divisor;
		const start = frame + duration;
		duration += timing.beatToFrame(timing.frameToBeat(start) + beats) - start;
	}
	return duration;
}

export function allegroPitch(value: string, previous: number): number {
	if (/^[\d.-]/.test(value)) return allegroNumber(value, 'pitch');
	const match = /^([A-G])([SF]*)(-?\d+)?$/i.exec(value);
	if (!match) throw new RangeError(`Invalid Allegro pitch: ${value}.`);
	const pitchClass = PITCH_CLASSES[match[1]!.toUpperCase()]!;
	const accidental = [...match[2]!.toUpperCase()].reduce((sum, char) => sum + (char === 'S' ? 1 : -1), 0);
	if (match[3] !== undefined) return (Number(match[3]) + 1) * 12 + pitchClass + accidental;
	const base = pitchClass + accidental;
	return base + Math.floor((previous - base + 6) / 12) * 12;
}

export function allegroVelocity(value: string): number {
	return DYNAMICS[value.toUpperCase()] ?? allegroNumber(value, 'velocity');
}

export function allegroString(value: string): string {
	if (value.startsWith('"')) {
		try { const parsed: unknown = JSON.parse(value); if (typeof parsed === 'string') return parsed; } catch { /* Report as format error below. */ }
		throw new RangeError('Invalid Allegro quoted string.');
	}
	if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
	throw new RangeError('Allegro string or atom must be quoted.');
}
