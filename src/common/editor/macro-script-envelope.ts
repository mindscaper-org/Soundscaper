/* SPDX-License-Identifier: AGPL-3.0-only */
import { fileValidationFailure as failure } from './file-validation-failure.ts';

/**
 * The file a macro program travels in.
 *
 * The extension is `.soundscapemacro`, not `.js`, and that is not cosmetic: a
 * bare `.js` file is executable by other things on the machine it lands on.
 * Double-clicking one can hand it to Node, to Windows Script Host, or to an
 * editor's run button. An artifact people email each other must not be
 * something their computer will happily run outside the sandbox it was written
 * for.
 *
 * The envelope is JSON so the importer can show what it is holding before the
 * reader is ever offered a way to run it.
 */

export const MACRO_SCRIPT_ENVELOPE_VERSION = 1 as const;
export const MACRO_SCRIPT_FILE_EXTENSION = '.soundscapemacro';
export const MACRO_SCRIPT_ENGINE = 'soundscaper-macro-js/1';

// JSON can expand each source code unit into a six-character Unicode escape.
export const MACRO_SCRIPT_FILE_MAXIMUM_BYTES = 2 * 1024 * 1024;
const MAX_ENVELOPE_CODE_UNITS = MACRO_SCRIPT_FILE_MAXIMUM_BYTES;
const MAX_SOURCE_CODE_UNITS = 256 * 1024;
const MAX_NAME_CODE_UNITS = 256;

export interface MacroScriptEnvelope {
	readonly schemaVersion: typeof MACRO_SCRIPT_ENVELOPE_VERSION;
	readonly kind: 'script';
	readonly engine: string;
	readonly name: string;
	readonly source: string;
}

export function serializeMacroScriptEnvelope(
	script: Readonly<{ name: string; source: string }>,
): string {
	const name = String(script.name ?? '').trim();
	if (!name) throw new TypeError('A macro program needs a name to be exported.');
	return `${JSON.stringify({
		schemaVersion: MACRO_SCRIPT_ENVELOPE_VERSION,
		kind: 'script',
		engine: MACRO_SCRIPT_ENGINE,
		name,
		source: String(script.source ?? ''),
	}, null, '\t')}\n`;
}

/**
 * Read a program file. Nothing here runs anything — it returns text and a name,
 * and the decision about whether that text may run is taken elsewhere, by a
 * person.
 */
export function parseMacroScriptEnvelope(text: unknown): MacroScriptEnvelope {
	if (typeof text !== 'string') throw failure(new TypeError('A macro program file must be text.'), 'macro', 'macroInvalidProgram', 'macroInvalidProgram');
	if (text.length > MAX_ENVELOPE_CODE_UNITS) throw failure(new RangeError('The macro program file is too large.'), 'macro', 'macroTooLarge', 'macroTooLarge', { maximum: MACRO_SCRIPT_FILE_MAXIMUM_BYTES });
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (cause) {
		throw failure(new SyntaxError(
			`That is not a macro program file: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause },
		), 'macro', 'json', 'macroInvalidJson');
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw failure(new TypeError('A macro program file holds one program.'), 'macro', 'macroInvalidProgram', 'macroInvalidProgram');
	}
	const envelope = value as Record<string, unknown>;
	if (envelope.kind !== 'script') throw failure(new RangeError('That file is not a macro program.'), 'macro', 'macroInvalidProgram', 'macroInvalidProgram');
	if (envelope.schemaVersion !== MACRO_SCRIPT_ENVELOPE_VERSION) {
		throw failure(new RangeError(`Unsupported macro program file version: ${String(envelope.schemaVersion)}.`), 'macro', 'macroVersion', 'macroVersion');
	}
	if (envelope.engine !== MACRO_SCRIPT_ENGINE) {
		throw failure(new RangeError(`Unsupported macro program engine: ${String(envelope.engine)}.`), 'macro', 'macroEngine', 'macroEngine');
	}
	const name = String(envelope.name ?? '').trim();
	if (!name) throw failure(new TypeError('A macro program file names its program.'), 'macro', 'macroName', 'macroName', { maximum: MAX_NAME_CODE_UNITS });
	if (name.length > MAX_NAME_CODE_UNITS) throw failure(new RangeError('The macro program name is too long.'), 'macro', 'macroName', 'macroName', { maximum: MAX_NAME_CODE_UNITS });
	if (typeof envelope.source !== 'string') throw failure(new TypeError('A macro program file carries its source.'), 'macro', 'macroInvalidProgram', 'macroInvalidProgram');
	if (envelope.source.length > MAX_SOURCE_CODE_UNITS) throw failure(new RangeError('The macro program is too large.'), 'macro', 'macroSourceTooLarge', 'macroSourceTooLarge', { maximum: MAX_SOURCE_CODE_UNITS });
	return Object.freeze({
		schemaVersion: MACRO_SCRIPT_ENVELOPE_VERSION,
		kind: 'script',
		engine: envelope.engine,
		name,
		source: envelope.source,
	});
}
