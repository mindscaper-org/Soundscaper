/* SPDX-License-Identifier: AGPL-3.0-only */
import { macroSyntaxError } from './audacity-macro-parser-failure.ts';
const MAX_MACRO_PARAMETERS = 512;

export function parseMacroParameters(source: string, lineNumber: number): Map<string, string> {
	const output = new Map<string, string>();
	let offset = 0;
	let count = 0;
	while (offset < source.length) {
		while (/\s/.test(source[offset] || '')) offset += 1;
		if (offset >= source.length) break;
		count += 1;
		if (count > MAX_MACRO_PARAMETERS) throw macroSyntaxError(lineNumber, 'too many parameters', undefined, 'PARAMETER_LIMIT');
		const nameStart = offset;
		while (offset < source.length && source[offset] !== '=') offset += 1;
		if (offset >= source.length) throw macroSyntaxError(lineNumber, 'a parameter is missing =', undefined, 'EQUALS');
		const name = source.slice(nameStart, offset).trim();
		if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)) {
			throw macroSyntaxError(lineNumber, `the parameter name ${JSON.stringify(name)} is malformed`, undefined, 'PARAMETER_NAME', name);
		}
		offset += 1;
		while (/\s/.test(source[offset] || '')) offset += 1;
		if (source[offset] !== '"') throw macroSyntaxError(lineNumber, `${name} must have a quoted value`, undefined, 'QUOTED_VALUE', name);
		offset += 1;
		let value = '';
		let closed = false;
		while (offset < source.length) {
			const character = source[offset++]!;
			if (character === '"') {
				closed = true;
				break;
			}
			if (character !== '\\') {
				value += character;
				continue;
			}
			if (offset >= source.length) throw macroSyntaxError(lineNumber, `${name} has an incomplete escape`, undefined, 'ESCAPE', name);
			const escaped = source[offset++]!;
			if (escaped === '\\' || escaped === '"') value += escaped;
			else if (escaped === 'n') value += '\n';
			else throw macroSyntaxError(lineNumber, `${name} has an unsupported \\${escaped} escape`, undefined, 'ESCAPE', name);
		}
		if (!closed) throw macroSyntaxError(lineNumber, `${name} has an unterminated quoted value`, undefined, 'UNTERMINATED', name);
		if (offset < source.length && !/\s/.test(source[offset])) {
			throw macroSyntaxError(lineNumber, `unexpected text after ${name}`, undefined, 'UNEXPECTED_TEXT', name);
		}
		// Audacity's config-backed parser uses the final occurrence.
		output.set(name, value);
	}
	return output;
}
