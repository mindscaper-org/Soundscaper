/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The macro programs a user keeps between sessions.
 *
 * Deliberately a sibling of the effect-macro library rather than a new version
 * of it. Bumping that library's schema would make an older build reject the
 * whole thing and then save over it, so a user who opened a stale build would
 * lose every macro they had. A separate key means an older build simply does
 * not read this one.
 *
 * Legacy review metadata stays readable for older versions of this library.
 * Imported programs execute only through an explicit sandboxed Run action.
 */

export const MACRO_SCRIPT_LIBRARY_SCHEMA_VERSION = 1;

const MAX_LIBRARY_SCRIPTS = 128;
const MAX_NAME_CODE_UNITS = 256;
const MAX_SOURCE_CODE_UNITS = 256 * 1024;

export type MacroScriptTrust = 'authored' | 'imported-untrusted' | 'imported-trusted';

export interface MacroScriptRecord {
	readonly id: string;
	readonly name: string;
	readonly source: string;
	readonly trust: MacroScriptTrust;
	/** Legacy review metadata, preserved for older library readers. */
	readonly trustedSource: string | null;
	readonly origin: string | null;
}

export interface MacroScriptLibraryState {
	readonly schemaVersion: typeof MACRO_SCRIPT_LIBRARY_SCHEMA_VERSION;
	readonly scripts: readonly MacroScriptRecord[];
}

export interface MacroScriptSaveOptions {
	readonly script: unknown;
	readonly idFactory?: (prefix: string) => string;
}

export function createMacroScriptLibrary(value: unknown = {}): MacroScriptLibraryState {
	const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
	if (source.schemaVersion != null && source.schemaVersion !== MACRO_SCRIPT_LIBRARY_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported macro script library schema: ${String(source.schemaVersion)}.`);
	}
	const scripts = Array.isArray(source.scripts)
		? source.scripts.map((script) => normalizeMacroScript(script))
		: [];
	return freezeLibrary(scripts);
}

export function macroScriptLibrarySchemaIsAhead(value: unknown): boolean {
	const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
	return typeof source.schemaVersion === 'number'
		&& Number.isFinite(source.schemaVersion)
		&& source.schemaVersion > MACRO_SCRIPT_LIBRARY_SCHEMA_VERSION;
}

export function listMacroScripts(state: unknown): readonly MacroScriptRecord[] {
	return createMacroScriptLibrary(state).scripts;
}

export function saveMacroScript(
	state: unknown,
	options: MacroScriptSaveOptions,
): Readonly<{ state: MacroScriptLibraryState; script: MacroScriptRecord }> {
	const current = createMacroScriptLibrary(state);
	const mint = options.idFactory ?? (() => `macro-script-${current.scripts.length + 1}`);
	const script = normalizeMacroScript({
		id: mint('macro-script'),
		...(options.script && typeof options.script === 'object' ? options.script : {}),
	});
	const index = current.scripts.findIndex((candidate) => candidate.id === script.id);
	if (index < 0 && current.scripts.length >= MAX_LIBRARY_SCRIPTS) {
		throw new RangeError('The macro program library is full.');
	}
	const scripts = index < 0
		? [...current.scripts, script]
		: current.scripts.map((candidate, at) => at === index ? script : candidate);
	return Object.freeze({ state: freezeLibrary(scripts), script });
}

export function deleteMacroScript(state: unknown, scriptId: string): MacroScriptLibraryState {
	const current = createMacroScriptLibrary(state);
	const id = String(scriptId ?? '');
	if (!current.scripts.some((script) => script.id === id)) {
		throw new ReferenceError(`Macro program ${id} does not exist.`);
	}
	return freezeLibrary(current.scripts.filter((script) => script.id !== id));
}

/** Nonempty programs are available to the same sandbox regardless of origin. */
export function macroScriptIsRunnable(script: Readonly<Partial<MacroScriptRecord>>): boolean {
	return typeof script.source === 'string' && script.source.trim().length > 0;
}

/** Preserve the legacy review marker for older consumers of the v1 library. */
export function trustMacroScript(state: unknown, scriptId: string): MacroScriptLibraryState {
	const current = createMacroScriptLibrary(state);
	const id = String(scriptId ?? '');
	const script = current.scripts.find((candidate) => candidate.id === id);
	if (!script) throw new ReferenceError(`Macro program ${id} does not exist.`);
	return freezeLibrary(current.scripts.map((candidate) => candidate.id === id
		? normalizeMacroScript({ ...candidate, trust: 'imported-trusted', trustedSource: script.source })
		: candidate));
}

/** Compatibility adapter: origin and legacy review metadata do not block execution. */
export function macroScriptSourceIsBlocked(
	_scripts: readonly Readonly<Partial<MacroScriptRecord>>[],
	source: string,
): boolean {
	return !macroScriptIsRunnable({ source });
}

export function normalizeMacroScript(value: unknown): MacroScriptRecord {
	const script = value && typeof value === 'object' ? value as Record<string, unknown> : {};
	const id = String(script.id ?? '').trim();
	if (!id || id.length > 1_024) throw new TypeError('A macro program needs a bounded stable ID.');
	const name = String(script.name ?? '').trim();
	if (!name) throw new TypeError('A macro program needs a name.');
	if (name.length > MAX_NAME_CODE_UNITS) throw new RangeError('The macro program name is too long.');
	const source = String(script.source ?? '');
	if (source.length > MAX_SOURCE_CODE_UNITS) throw new RangeError('The macro program is too large.');
	const trust = script.trust === 'imported-untrusted' || script.trust === 'imported-trusted'
		? script.trust
		: 'authored';
	return Object.freeze({
		id,
		name,
		source,
		trust,
		trustedSource: trust === 'imported-trusted' && typeof script.trustedSource === 'string'
			? script.trustedSource
			: null,
		origin: typeof script.origin === 'string' && script.origin ? script.origin : null,
	});
}

function freezeLibrary(scripts: readonly MacroScriptRecord[]): MacroScriptLibraryState {
	if (new Set(scripts.map(({ id }) => id)).size !== scripts.length) {
		throw new RangeError('Macro program IDs must be unique.');
	}
	if (scripts.length > MAX_LIBRARY_SCRIPTS) throw new RangeError('The macro program library is full.');
	return Object.freeze({
		schemaVersion: MACRO_SCRIPT_LIBRARY_SCHEMA_VERSION,
		scripts: Object.freeze([...scripts]),
	});
}
