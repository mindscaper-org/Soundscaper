/* SPDX-License-Identifier: AGPL-3.0-only */
export type AepTextValue = string | number | boolean | null | readonly AepTextValue[] | ReadonlyMap<string, AepTextValue>;
/** Bounded data grammar only. PostScript operators, references and evaluation are never admitted. */
export function parseAepTextDictionary(bytes: Uint8Array): ReadonlyMap<string, AepTextValue> {
	if (bytes.length > 8 * 1024 * 1024) throw new RangeError('AEP text dictionary exceeds its byte budget.');
	let cursor = 0, tokens = 0;
	const whitespace = () => { while (cursor < bytes.length && [0, 9, 10, 12, 13, 32].includes(bytes[cursor]!)) cursor++; };
	const token = (): string => {
		const start = cursor; while (cursor < bytes.length && ![0, 9, 10, 12, 13, 32, 40, 41, 60, 62, 91, 93].includes(bytes[cursor]!)) cursor++;
		if (start === cursor) throw new TypeError('AEP text dictionary token is malformed.');
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start, cursor));
	};
	function dictionary(depth: number, terminated: boolean): ReadonlyMap<string, AepTextValue> {
		const entries = new Map<string, AepTextValue>();
		while (true) {
			whitespace();
			if (terminated && bytes[cursor] === 62 && bytes[cursor + 1] === 62) { cursor += 2; return entries; }
			if (cursor === bytes.length && !terminated) return entries;
			if (bytes[cursor++] !== 47) throw new TypeError('AEP text dictionary needs a named key.');
			const key = token(); if (entries.has(key)) throw new TypeError('AEP text dictionary key is duplicated.'); entries.set(key, value(depth + 1));
		}
	}
	function value(depth: number): AepTextValue {
		if (depth > 64 || ++tokens > 250_000) throw new RangeError('AEP text dictionary exceeds its nesting or token budget.');
		whitespace(); const first = bytes[cursor++];
		if (first === 60 && bytes[cursor++] === 60) return dictionary(depth, true);
		if (first === 91) {
			const result: AepTextValue[] = []; while (true) { whitespace(); if (bytes[cursor] === 93) { cursor++; return result; } result.push(value(depth + 1)); }
		}
		if (first === 40) {
			const result: number[] = []; let closed = false;
			while (cursor < bytes.length) {
				let next = bytes[cursor++]!;
				if (next === 41) { closed = true; break; }
				if (next === 92) {
					if (cursor >= bytes.length) break; next = bytes[cursor++]!;
					if (next >= 48 && next <= 55) { let octal = String.fromCharCode(next); for (let n = 0; n < 2 && bytes[cursor]! >= 48 && bytes[cursor]! <= 55; n++) octal += String.fromCharCode(bytes[cursor++]!); next = Number.parseInt(octal, 8) & 255; }
					else next = ({ 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 } as Readonly<Record<number, number>>)[next] ?? next;
				}
				result.push(next);
			}
			if (!closed) throw new TypeError('AEP text string is unterminated.');
			const raw = Uint8Array.from(result);
			return new TextDecoder(raw[0] === 254 && raw[1] === 255 ? 'utf-16be' : 'utf-8', { fatal: true }).decode(raw);
		}
		cursor--; const item = token();
		if (item === 'true' || item === 'false') return item === 'true';
		if (item.startsWith('/')) return item === '/nil' ? null : item;
		if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(item)) throw new TypeError('AEP text dictionary contains an unsupported token.');
		const number = Number(item); if (!Number.isFinite(number) || Math.abs(number) > 1e12) throw new RangeError('AEP text number is outside its bounded range.'); return number;
	}
	return dictionary(0, false);
}
export function aepTextAt(value: AepTextValue | undefined, ...path: readonly (string | number)[]): AepTextValue | undefined {
	for (const part of path) value = value instanceof Map && typeof part === 'string' ? value.get(part) : Array.isArray(value) && typeof part === 'number' ? value[part] : undefined;
	return value;
}
