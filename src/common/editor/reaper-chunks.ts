/* SPDX-License-Identifier: AGPL-3.0-only */

import { TIMELINE_INTERCHANGE_MAXIMUM_BYTES, TIMELINE_INTERCHANGE_MAXIMUM_DEPTH,
	TIMELINE_INTERCHANGE_MAXIMUM_ITEMS } from './timeline-interchange-types.ts';

export interface ReaperLine {
	readonly kind: 'line';
	readonly name: string;
	readonly values: readonly string[];
}
export interface ReaperChunk {
	readonly kind: 'chunk';
	readonly name: string;
	readonly values: readonly string[];
	readonly entries: readonly ReaperEntry[];
}
export type ReaperEntry = ReaperLine | ReaperChunk;

/** RPP is a line-oriented chunk stream, not XML. Backslashes are literal. */
export function parseReaperChunks(text: string): ReaperChunk {
	if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > TIMELINE_INTERCHANGE_MAXIMUM_BYTES) {
		throw new RangeError('The REAPER document exceeds the text byte limit.');
	}
	if (text.includes('\0')) throw new SyntaxError('REAPER documents cannot contain NUL bytes.');
	type MutableChunk = Omit<ReaperChunk, 'entries'> & { entries: ReaperEntry[] };
	const stack: MutableChunk[] = [];
	let root: MutableChunk | undefined;
	let count = 0;
	for (const match of text.replace(/^\uFEFF/u, '').matchAll(/[^\r\n]+/gu)) {
		const line = match[0].trim();
		if (!line || /^[;#]/u.test(line)) continue;
		if (++count > TIMELINE_INTERCHANGE_MAXIMUM_ITEMS) throw new RangeError('REAPER item limit exceeded.');
		if (line === '>') {
			if (!stack.pop()) throw new SyntaxError('Unexpected REAPER chunk terminator.');
			continue;
		}
		// Notes and embedded code use raw pipe-prefixed lines, with arbitrary quotes.
		const tokens = line.startsWith('|') ? [line] : tokenize(line);
		const name = tokens[0]!;
		const parent = stack.at(-1);
		if (name.startsWith('<')) {
			if (stack.length >= TIMELINE_INTERCHANGE_MAXIMUM_DEPTH) throw new RangeError('REAPER depth limit exceeded.');
			const chunk: MutableChunk = { kind: 'chunk', name: name.slice(1), values: tokens.slice(1), entries: [] };
			if (parent) parent.entries.push(chunk);
			else if (root) throw new SyntaxError('A REAPER document must contain one root chunk.');
			else root = chunk;
			stack.push(chunk);
		} else {
			if (!parent) throw new SyntaxError('REAPER data outside the root chunk.');
			parent.entries.push({ kind: 'line', name, values: tokens.slice(1) });
		}
	}
	if (stack.length || root?.name !== 'REAPER_PROJECT') throw new SyntaxError('A complete REAPER_PROJECT chunk is required.');
	return root;
}

export function reaperValues(entries: readonly ReaperEntry[], name: string): readonly string[] | undefined {
	const lines = entries.filter((entry): entry is ReaperLine => entry.kind === 'line' && entry.name === name);
	if (lines.length > 1) throw new SyntaxError(`Duplicate REAPER ${name} control.`);
	return lines[0]?.values;
}

export function reaperChildren(entries: readonly ReaperEntry[], name: string): readonly ReaperChunk[] {
	return entries.filter((entry): entry is ReaperChunk => entry.kind === 'chunk' && entry.name === name);
}

function tokenize(line: string): string[] {
	const tokens: string[] = [];
	let index = 0;
	while (index < line.length) {
		while (line[index] === ' ' || line[index] === '\t') index++;
		if (index === line.length || line[index] === ';' || line[index] === '#') break;
		const quote = line[index]!;
		if (quote === '"' || quote === "'" || quote === '`') {
			const end = line.indexOf(quote, index + 1);
			if (end < 0) throw new SyntaxError('Unterminated REAPER quoted string.');
			tokens.push(line.slice(index + 1, end)); index = end + 1;
		} else {
			const start = index;
			while (index < line.length && line[index] !== ' ' && line[index] !== '\t') index++;
			tokens.push(line.slice(start, index));
		}
		if (tokens.length > 4096) throw new RangeError('REAPER line token limit exceeded.');
	}
	return tokens;
}
