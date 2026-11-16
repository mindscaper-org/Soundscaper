/* SPDX-License-Identifier: AGPL-3.0-only */
export interface AdlField { readonly key: string; readonly values: readonly string[] }

/** EDML has parenthesized keywords and quoted strings, not XML text nodes. */
export function readAdlSections(text: string): ReadonlyMap<string, readonly AdlField[]> {
	if (new TextEncoder().encode(text).byteLength > 32 * 1024 * 1024) throw new RangeError('ADL text exceeds the import limit.');
	const sections = new Map<string, AdlField[]>();
	const stack: string[] = [];
	let current: { key: string; values: string[] } | null = null, rootSeen = false, count = 0;
	const token = /\s+|"(?:[^"]|"")*"|<\/?[A-Za-z][A-Za-z0-9_]*>|\([A-Za-z][A-Za-z0-9_]*\)|[^\s"<>()]+/uy;
	let offset = 0;
	while (offset < text.length) {
		token.lastIndex = offset;
		const match = token.exec(text);
		if (!match || match.index !== offset) throw new SyntaxError('Malformed ADL markup or quoted string.');
		offset = token.lastIndex;
		const value = match[0];
		if (/^\s/u.test(value)) continue;
		if (++count > 1_000_000) throw new RangeError('ADL token count exceeds the import limit.');
		if (value.startsWith('<')) {
			current = null;
			const closing = value.startsWith('</'), name = value.slice(closing ? 2 : 1, -1).toUpperCase();
			if (closing) {
				if (stack.pop() !== name) throw new SyntaxError('Unbalanced ADL sections.');
			} else {
				if (!stack.length) {
					if (name !== 'ADL' || rootSeen) throw new SyntaxError('An ADL root is required.');
					rootSeen = true;
				} else {
					if (stack.length !== 1 || sections.has(name)) throw new SyntaxError('Duplicate or nested ADL section.');
					sections.set(name, []);
				}
				stack.push(name);
			}
		} else if (value.startsWith('(')) {
			if (stack.length !== 2) throw new SyntaxError('ADL keywords must be inside a section.');
			current = { key: value.slice(1, -1).toUpperCase(), values: [] };
			sections.get(stack[1]!)!.push(current);
		} else {
			if (!current) throw new SyntaxError('ADL value has no keyword.');
			current.values.push(value.startsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value);
		}
	}
	if (!rootSeen || stack.length) throw new SyntaxError('Incomplete ADL document.');
	return sections;
}

export function adlField(fields: readonly AdlField[], key: string, fallback?: string): string {
	const matches = fields.filter(field => field.key === key);
	if (matches.length > 1) throw new SyntaxError(`Duplicate ADL ${key}.`);
	const value = matches[0]?.values[0] ?? fallback;
	if (value === undefined) throw new SyntaxError(`Missing ADL ${key}.`);
	return value;
}

export function adlEntries(fields: readonly AdlField[], key: string): readonly (readonly AdlField[])[] {
	const entries: AdlField[][] = [];
	for (const field of fields) {
		if (field.key === key) entries.push([]);
		const last = entries.at(-1);
		if (!last) throw new SyntaxError(`ADL list requires ${key}.`);
		last.push(field);
	}
	if (entries.length > 100_000) throw new RangeError('ADL item count exceeds the import limit.');
	return entries;
}

export function adlInteger(value: unknown, name: string, minimum = 0): number {
	const number = typeof value === 'string' && !/^\d+$/u.test(value) ? NaN : Number(value);
	if (!Number.isSafeInteger(number) || number < minimum) throw new RangeError(`Invalid ADL ${name}.`);
	return number;
}

export function adlChannelRange(value: string): number[] {
	const match = /^(\d+)(?:~(\d+))?$/u.exec(value);
	if (!match) throw new TypeError('Invalid ADL channel range.');
	const first = adlInteger(match[1], 'channel', 1), last = adlInteger(match[2] ?? match[1], 'channel', 1);
	if (last < first || last > 256 || last - first > 1) throw new RangeError('This ADL profile supports mono/stereo channel ranges through channel 256.');
	return Array.from({ length: last - first + 1 }, (_, index) => first + index - 1);
}
