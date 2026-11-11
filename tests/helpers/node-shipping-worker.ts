/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TestContext } from 'node:test';
import { Worker } from 'node:worker_threads';

interface WorkerEvent {
	readonly data?: unknown;
	readonly error?: Error;
	readonly message?: string;
}

export interface NodeShippingWorkerPort {
	postMessage(message: unknown, transfer?: readonly ArrayBuffer[]): void;
	addEventListener(type: string, listener: (event: WorkerEvent) => void): void;
	terminate(): void;
}

interface WorkerRecord {
	readonly worker: Worker;
	readonly exited: Promise<void>;
	terminationRequested: boolean;
	exitCode: number | null;
	renderRequests: number;
	completedRenders: number;
	chunks: number;
}

function workerError(cause: unknown): Error {
	return cause instanceof Error ? cause : new Error(String(cause), { cause });
}

// MessagePort queues incoming messages until the shipping entry installs its
// listener. No synthetic ready, progress, render or completion events are sent.
const bootstrap = `import { parentPort, workerData } from 'node:worker_threads';
if (!parentPort) throw new Error('A shipping worker requires its real parent port.');
const listeners = new Map();
Object.defineProperty(globalThis, 'self', { value: {
	postMessage: (data, transfer = []) => parentPort.postMessage(data, transfer),
	addEventListener(type, listener) {
		if (type !== 'message') throw new Error('Unsupported shipping worker scope event: ' + type);
		const callback = data => listener({ data });
		listeners.set(listener, callback); parentPort.on('message', callback);
	},
	removeEventListener(type, listener) {
		const callback = listeners.get(listener);
		if (type === 'message' && callback) { parentPort.off('message', callback); listeners.delete(listener); }
	},
} });
await import(workerData.entry);
`;

/** Run a shipping module unchanged, adapting only isolated worker messaging and lifecycle. */
export function createNodeShippingWorkers(context: TestContext) {
	const records: WorkerRecord[] = [];
	let disposal: Promise<void> | undefined;
	const createWorker = (entry: URL): NodeShippingWorkerPort => {
		if (disposal) throw new Error('The shipping worker owner is disposed.');
		if (entry.protocol !== 'file:') throw new TypeError('Shipping worker entries must be physical module files.');
		const worker = new Worker(new URL(`data:text/javascript;base64,${Buffer.from(bootstrap).toString('base64')}`), {
			workerData: { entry: entry.href }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 512 },
		});
		const listeners = new Map<string, Set<(event: WorkerEvent) => void>>();
		const emit = (type: string, event: WorkerEvent): void => {
			for (const listener of listeners.get(type) ?? []) listener(event);
		};
		const exited = new Promise<void>(resolve => {
			worker.once('exit', code => {
				record.exitCode = code;
				// Record the real exit before notifying borrowers: a failing listener
				// must not leave disposal waiting for an exit that already happened.
				resolve();
				// Node exposes exit explicitly. Fail a pending shipping client rather
				// than leave its request waiting after its transport has disappeared.
				if (!record.terminationRequested) {
					const error = new Error(`The shipping worker exited unexpectedly (code ${code}).`);
					emit('error', { error, message: error.message });
				}
			});
		});
		const record: WorkerRecord = { worker, exited, terminationRequested: false, exitCode: null,
			renderRequests: 0, completedRenders: 0, chunks: 0 };
		records.push(record);
		worker.on('message', (data: unknown) => {
			const type: unknown = data && typeof data === 'object' ? Reflect.get(data, 'type') : null;
			if (type === 'result') record.completedRenders++;
			if (type === 'chunk') record.chunks++;
			emit('message', { data });
		});
		worker.on('error', cause => {
			const error = workerError(cause); emit('error', { error, message: error.message });
		});
		worker.on('messageerror', cause => { emit('messageerror', { error: workerError(cause) }); });
		return {
			postMessage(message, transfer = []) {
				if (message && typeof message === 'object' && Reflect.get(message, 'type') === 'render') record.renderRequests++;
				worker.postMessage(message, [...transfer]);
			},
			addEventListener(type, listener) {
				let current = listeners.get(type);
				if (!current) { current = new Set(); listeners.set(type, current); }
				current.add(listener);
			},
			terminate() {
				record.terminationRequested = true;
				// The owner below awaits the real exit event, including failure paths.
				void worker.terminate().catch((cause: unknown) => {
					const error = workerError(cause); emit('error', { error, message: error.message });
				});
			},
		};
	};
	const dispose = (): Promise<void> => {
		disposal ??= (async () => {
			for (const record of records) record.terminationRequested = true;
			await Promise.all(records.map(record => record.worker.terminate()));
			await Promise.all(records.map(record => record.exited));
		})();
		return disposal;
	};
	context.after(dispose);
	return { createWorker, dispose, snapshot: () => Object.freeze(records.map(record => Object.freeze({
		terminationRequested: record.terminationRequested, exitCode: record.exitCode,
		renderRequests: record.renderRequests, completedRenders: record.completedRenders, chunks: record.chunks,
	}))) };
}
