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
		const start = frame + duration;
		const numeric = /^(-?(?:\d+(?:\.\d*)?|\.\d+))(.*)$/i.exec(term);
		const seconds = numeric ? allegroNumber(numeric[1]!, 'duration') : null;
		if (seconds !== null && seconds < 0) throw new RangeError('Allegro duration cannot be negative.');
		let suffix = numeric ? numeric[2]! : term.slice(1);
		if (seconds !== null && !suffix) { duration += seconds * sampleRate; continue; }
		let beats = seconds === null ? DURATIONS[term[0]!.toUpperCase()]
			: timing.frameToBeat(start + seconds * sampleRate) - timing.frameToBeat(start);
		if (beats === undefined) throw new RangeError(`Invalid Allegro duration: ${term}.`);
		while (suffix) {
			const modifier = /^([.T]|\/?\d+(?:\.\d*)?)/i.exec(suffix);
			if (!modifier) throw new RangeError(`Invalid Allegro duration: ${term}.`);
			const token = modifier[0].toUpperCase();
			if (token === '.') beats *= 1.5;
			else if (token === 'T') beats *= 2 / 3;
			else if (token.startsWith('/')) {
				const divisor = allegroNumber(token.slice(1), 'duration divisor');
				if (!divisor) throw new RangeError('Allegro duration divisor cannot be zero.');
				beats /= divisor;
			} else beats *= allegroNumber(token, 'duration multiplier');
			suffix = suffix.slice(token.length);
		}
		duration += timing.beatToFrame(timing.frameToBeat(start) + beats) - start;
	}
	return duration;
}

export function allegroPitch(value: string, _previous: number): number {
	if (/^[\d.-]/.test(value)) return allegroNumber(value, 'pitch');
	const match = /^([A-G])([SF]*)(-?\d+)?([SF]*)$/i.exec(value);
	if (!match) throw new RangeError(`Invalid Allegro pitch: ${value}.`);
	const pitchClass = PITCH_CLASSES[match[1]!.toUpperCase()]!;
	const accidental = [...`${match[2]}${match[4]}`.toUpperCase()].reduce((sum, char) => sum + (char === 'S' ? 1 : -1), 0);
	if (match[3] !== undefined) return (Number(match[3]) + 1) * 12 + pitchClass + accidental;
	return 12 + pitchClass + accidental;
}

export function allegroVelocity(value: string): number {
	return DYNAMICS[value.toUpperCase()] ?? allegroNumber(value, 'velocity');
}

export function allegroString(value: string): string {
	if (value.startsWith('"') && value.endsWith('"')) {
		let text = '';
		for (let index = 1; index < value.length - 1; index += 1) {
			let character = value[index]!;
			if (character === '\\') {
				index += 1;
				if (index >= value.length - 1) throw new RangeError('Invalid Allegro quoted string.');
				character = value[index]!;
			} else if (character === '"') throw new RangeError('Invalid Allegro quoted string.');
			text += character;
		}
		return text;
	}
	if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
	throw new RangeError('Allegro string or atom must be quoted.');
}

/** PortSMF quotes only escape the following literal byte; JSON escapes differ. */
export function allegroQuotedString(value: string): string {
	if (/[\r\n\0]/u.test(value)) throw new RangeError('Text containing line breaks or NUL cannot be represented in Allegro. Export MIDI instead.');
	return `"${value.replace(/[\\"]/gu, character => `\\${character}`)}"`;
}
