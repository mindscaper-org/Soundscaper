/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { BrowserMacroSandboxOptions } from '../../src/common/editor/macro-script/browser-sandbox.ts';
import { macroPreludeImportSource } from '../../src/common/editor/macro-script/browser-prelude-loader.ts';
import { createMacroSandboxClient, type MacroSandboxWorker } from '../../src/common/editor/macro-script/sandbox-client.ts';
import type { MacroThreadEntryEvent } from './macro-thread-entry.ts';

interface ThreadEvent { readonly direction: string; readonly data?: unknown; readonly code?: number; readonly message?: string }
interface ThreadRecord {
	readonly worker: Worker;
	readonly exited: Promise<void>;
	readonly sourceSha256: string;
	readonly events: ThreadEvent[];
	termination: Promise<number> | undefined;
	terminationRequested: boolean;
	exitCode: number | null;
}
type WorkerEvent = MacroThreadEntryEvent;
interface MacroThreadOwner {
	readonly createWorker: (source: string, name: string) => MacroSandboxWorker;
	readonly snapshot: () => readonly Readonly<{ sourceSha256: string; exitCode: number | null; terminationRequested: boolean; events: readonly ThreadEvent[] }>[];
	readonly dispose: () => Promise<void>;
}
let activeOwner: MacroThreadOwner | null = null;

/** Real ESM Worker transport for reviewed literals; browser CSP/security coverage remains native. */
export function createMacroThreadOwner() {
	assert.equal(activeOwner, null, 'one macro thread owner at a time');
	const records: ThreadRecord[] = [];
	let disposal: Promise<void> | undefined;
	const createWorker = (source: string, name: string): MacroSandboxWorker => {
		assert.equal(disposal, undefined, 'disposed worker owner');
		const worker = new Worker(new URL('./macro-thread-entry.ts', import.meta.url), {
			workerData: { moduleUrl: `data:text/javascript;base64,${Buffer.from(source).toString('base64')}` },
			name, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 512 },
		});
		const listeners = new Map<string, Set<(event: never) => void>>();
		const emit = (type: string, event: WorkerEvent): void => {
			for (const listener of listeners.get(type) ?? []) listener(event as never);
		};
		const exited = new Promise<void>(resolve => {
			worker.once('exit', code => {
				record.exitCode = code; record.events.push({ direction: 'exit', code }); resolve();
				if (!record.terminationRequested) {
					const error = new Error(`Actual macro worker exited unexpectedly (${code}).`);
					emit('error', { error, message: error.message });
				}
			});
		});
		const record: ThreadRecord = { worker, exited, sourceSha256: createHash('sha256').update(source).digest('hex'),
			events: [], termination: undefined, terminationRequested: false, exitCode: null };
		records.push(record);
		worker.on('message', (data: unknown) => {
			record.events.push({ direction: 'worker-to-host', data }); emit('message', { data });
		});
		for (const type of ['error', 'messageerror'] as const) worker.on(type, (cause: unknown) => {
			const error = cause instanceof Error ? cause : new Error(String(cause), { cause });
			record.events.push({ direction: type, message: error.message }); emit(type, { error, message: error.message });
		});
		return {
			postMessage(message) { record.events.push({ direction: 'host-to-worker', data: message }); worker.postMessage(message); },
			addEventListener(type, listener) {
				let current = listeners.get(type);
				if (!current) { current = new Set(); listeners.set(type, current); }
				current.add(listener);
			},
			terminate() { void terminate(record).catch((cause: unknown) => {
				const error = cause instanceof Error ? cause : new Error(String(cause), { cause }); emit('error', { error, message: error.message });
			}); },
		};
	};
	const snapshot = () => records.map(record => ({ sourceSha256: record.sourceSha256,
		exitCode: record.exitCode, terminationRequested: record.terminationRequested, events: structuredClone(record.events) }));
	const dispose = (): Promise<void> => {
		disposal ??= (async () => {
			try {
				const terminations = await Promise.allSettled(records.map(terminate));
				await Promise.all(records.map(record => record.exited));
				const errors = terminations.filter(result => result.status === 'rejected').map(result => result.reason as unknown);
				if (errors.length) throw new AggregateError(errors, 'Macro Worker termination failed.');
			} finally { if (activeOwner === owner) activeOwner = null; }
		})();
		return disposal;
	};
	const owner = { createWorker, snapshot, dispose };
	activeOwner = owner;
	return owner;
}

function terminate(record: ThreadRecord): Promise<number> {
	record.terminationRequested = true;
	return record.termination ??= record.worker.terminate();
}

/** Substitute only Blob/Worker construction; the caller supplies the unmodified product dispatch. */
export function createBrowserMacroSandbox(options: BrowserMacroSandboxOptions) {
	assert.ok(activeOwner, 'the public macro action requires an owned thread transport');
	return createMacroSandboxClient({ ...options,
		preludeSource: macroPreludeImportSource(new URL('../../src/common/editor/macro-script/sandbox-prelude.js', import.meta.url).href, import.meta.url),
		createWorker: activeOwner.createWorker,
		setTimer: (callback, delay) => setTimeout(callback, delay),
		clearTimer: handle => { clearTimeout(handle as ReturnType<typeof setTimeout>); },
	});
}
