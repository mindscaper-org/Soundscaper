/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudacityShortcutImportPlan, parseAudacityShortcutImport } from '../../audacity-shortcut-import.ts';

export interface ShortcutImportSource {
	readonly xml: string;
	readonly parse: typeof parseAudacityShortcutImport;
}

export interface ShortcutImportFile {
	readonly size: number;
	readonly text: () => PromiseLike<string>;
}

export interface ShortcutImportModule {
	readonly AUDACITY_SHORTCUT_IMPORT_MAX_BYTES: number;
	readonly parseAudacityShortcutImport: typeof parseAudacityShortcutImport;
}

interface ShortcutImportSessionOptions {
	readonly loadImporter: () => PromiseLike<ShortcutImportModule>;
	readonly saveShortcuts: (shortcuts: AudacityShortcutImportPlan['shortcuts']) => unknown;
	readonly onSource: (source: ShortcutImportSource | null) => void;
	readonly onBusy: (busy: boolean) => void;
	readonly onReadError: (error: 'invalid' | 'too-large' | null) => void;
	readonly onImported: (count: number | null) => void;
}

export interface ShortcutImportSession {
	readonly read: (file: ShortcutImportFile) => Promise<void>;
	readonly apply: (plan: AudacityShortcutImportPlan) => Promise<void>;
	readonly cancel: () => void;
	readonly dispose: () => void;
}

/** Own asynchronous import work while the presentation owns the review state. */
export function createShortcutImportSession(options: ShortcutImportSessionOptions): ShortcutImportSession {
	let revision = 0;
	let disposed = false;
	let phase: 'idle' | 'reading' | 'saving' = 'idle';
	const current = (request: number) => !disposed && revision === request;
	return { read, apply, cancel, dispose };

	async function read(file: ShortcutImportFile): Promise<void> {
		if (disposed || phase === 'saving') return;
		const request = ++revision;
		phase = 'reading';
		options.onSource(null);
		options.onReadError(null);
		options.onImported(null);
		options.onBusy(true);
		try {
			const importer = await options.loadImporter();
			if (!current(request)) return;
			if (file.size > importer.AUDACITY_SHORTCUT_IMPORT_MAX_BYTES) {
				options.onReadError('too-large');
				return;
			}
			const xml = await file.text();
			if (current(request)) options.onSource({ xml, parse: importer.parseAudacityShortcutImport });
		} catch {
			if (current(request)) options.onReadError('invalid');
		} finally {
			if (current(request)) {
				phase = 'idle';
				options.onBusy(false);
			}
		}
	}

	async function apply(plan: AudacityShortcutImportPlan): Promise<void> {
		if (disposed || phase !== 'idle' || !plan.importedCount) return;
		const request = ++revision;
		phase = 'saving';
		options.onReadError(null);
		options.onImported(null);
		options.onBusy(true);
		try {
			await options.saveShortcuts(plan.shortcuts);
			if (!current(request)) return;
			options.onSource(null);
			options.onImported(plan.importedCount);
		} catch {
			// The injected save operation reports persistence failures. Retain the
			// source so the presentation can review the rolled-back state and retry.
		} finally {
			if (current(request)) {
				phase = 'idle';
				options.onBusy(false);
			}
		}
	}

	function cancel(): void {
		if (disposed || phase === 'saving') return;
		revision += 1;
		phase = 'idle';
		options.onSource(null);
		options.onReadError(null);
		options.onImported(null);
		options.onBusy(false);
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		revision += 1;
	}
}
