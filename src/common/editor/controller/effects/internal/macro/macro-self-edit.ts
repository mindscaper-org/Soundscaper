/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeMacroScript, type MacroScriptRecord } from '../../../../macro-script-library.ts';

interface Library {
	readonly list: () => readonly MacroScriptRecord[];
	readonly readOnly: () => boolean;
	readonly save: (record: MacroScriptRecord) => MacroScriptRecord;
}

/** Bind self-editing to the explicit saved identity, never to matching names or source text. */
export function createMacroSelfEdit(library: Library, source: string, scriptId?: string, assertWritable: () => void = () => undefined) {
	const original = scriptId === undefined ? null : library.list().find(script => script.id === scriptId);
	if (scriptId !== undefined && (!original || original.source !== source)) throw new Error('The saved program changed before the run began.');
	let staged = source;
	let requested = false;
	let published: MacroScriptRecord | null = null;
	return Object.freeze({ source: () => staged, replaceSource, commit, rollback });

	function replaceSource(value: unknown): null {
		if (!original) throw new Error('Only a saved program can replace its own source.');
		if (typeof value !== 'string') throw new TypeError('Program source must be a string.');
		staged = normalizeMacroScript({ ...original, source: value }).source;
		requested = true;
		return null;
	}

	function commit(): void {
		if (!requested || !original) return;
		assertWritable();
		if (library.readOnly()) throw new Error('The macro script library is read-only.');
		const current = library.list().find(script => script.id === original.id);
		if (!same(current, original)) throw new Error('The saved program changed during the run; its source was not replaced.');
		published = library.save({ ...original, source: staged });
	}

	function rollback(): void {
		if (!published || !original) return;
		assertWritable();
		if (same(library.list().find(script => script.id === original.id), published)) library.save(original);
	}
}

function same(left: MacroScriptRecord | undefined, right: MacroScriptRecord): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
