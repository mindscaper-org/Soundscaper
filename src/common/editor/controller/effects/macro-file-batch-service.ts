/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MacroAudioInputResolver } from '../../macro-audio-input.ts';

export type MacroFileBatchDefinition =
	| Readonly<{ kind: 'script'; name: string; source: string }>
	| Readonly<{ kind: 'steps'; name: string; effects: readonly Readonly<Record<string, unknown>>[] }>;
export type MacroFileBatchFormat = 'wav' | 'flac' | 'mp3';
export interface MacroFileBatchRow {
	readonly name: string;
	readonly status: 'completed' | 'failed' | 'cancelled' | 'skipped';
	readonly message?: string;
}
export interface MacroFileBatchRequest<Input = Readonly<{ name: string }>, Target = unknown> {
	readonly macro: MacroFileBatchDefinition;
	readonly items: readonly Readonly<{ input: Input; target: Target }>[];
	readonly format: MacroFileBatchFormat;
	readonly signal: AbortSignal;
	readonly resolveAudioInput?: MacroAudioInputResolver;
	readonly onProgress?: (rows: readonly MacroFileBatchRow[], total: number, current: string | null) => void;
}
export interface MacroFileBatchSession<Target> {
	run(macro: MacroFileBatchDefinition, resolver: MacroAudioInputResolver | undefined, signal: AbortSignal): Promise<unknown>;
	export(target: Target, format: MacroFileBatchFormat, signal: AbortSignal): Promise<unknown>;
	dispose(): Promise<unknown>;
}

/** One temporary project at a time; an unsuccessful program never exports its input. */
export async function runMacroFileBatch<Input extends Readonly<{ name: string }>, Target>(
	ports: Readonly<{ createSession(input: Input, signal: AbortSignal): Promise<MacroFileBatchSession<Target>> }>,
	request: MacroFileBatchRequest<Input, Target>,
): Promise<readonly MacroFileBatchRow[]> {
	if (!request.items.length || request.items.length > 100) throw new RangeError('Choose between 1 and 100 input files.');
	const rows: MacroFileBatchRow[] = [];
	for (const { input, target } of request.items) {
		if (request.signal.aborted) { rows.push({ name: input.name, status: 'skipped' }); continue; }
		request.onProgress?.(rows.slice(), request.items.length, input.name);
		let session: MacroFileBatchSession<Target> | null = null;
		let row: MacroFileBatchRow;
		try {
			request.signal.throwIfAborted();
			session = await ports.createSession(input, request.signal);
			request.signal.throwIfAborted();
			await session.run(request.macro, request.resolveAudioInput, request.signal);
			request.signal.throwIfAborted();
			await session.export(target, request.format, request.signal);
			row = { name: input.name, status: 'completed' };
		} catch (error) {
			row = { name: input.name, status: request.signal.aborted ? 'cancelled' : 'failed', message: error instanceof Error ? error.message : String(error) };
		} finally {
			try { await session?.dispose(); }
			catch (error) { row = { name: input.name, status: 'failed', message: error instanceof Error ? error.message : String(error) }; }
		}
		rows.push(row!);
		request.onProgress?.(rows.slice(), request.items.length, null);
	}
	return rows;
}
