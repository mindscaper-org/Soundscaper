/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TestContext } from 'node:test';
import { Worker as NodeWorker } from 'node:worker_threads';

const bootstrap = `const { parentPort, workerData } = require('node:worker_threads');
const listeners = new Map();
const scope = {
	postMessage: (data, transfer = []) => parentPort.postMessage(data, transfer),
	addEventListener(type, listener) {
		const callback = data => listener({ data });
		listeners.set(listener, callback); parentPort.on(type, callback);
	},
	removeEventListener(type, listener) {
		const callback = listeners.get(listener);
		if (callback) parentPort.off(type, callback);
		listeners.delete(listener);
	},
	set onmessage(listener) { parentPort.removeAllListeners('message'); parentPort.on('message', data => listener({ data })); },
};
globalThis.self = globalThis;
Object.defineProperties(globalThis, Object.getOwnPropertyDescriptors(scope));
void import(workerData.entry).catch(error => { throw error; });`;

/** Real editor workers, with browser messaging adapted to Node and owned cleanup. */
export function installNodeEditorWorkers(context: TestContext): void {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
	const workers = new Set<NodeWorker>();
	class EditorWorker {
		readonly #worker: NodeWorker;
		readonly #listeners = new Map<EventListener, (value: unknown) => void>();
		onmessage: ((event: MessageEvent) => void) | null = null;
		onerror: ((event: ErrorEvent) => void) | null = null;
		constructor(entry: URL) {
			if (!(entry instanceof URL) || entry.protocol !== 'file:') throw new DOMException('Only local editor workers are available.', 'NotSupportedError');
			this.#worker = new NodeWorker(bootstrap, { eval: true, workerData: { entry: entry.href }, execArgv: [],
				resourceLimits: { maxOldGenerationSizeMb: 512 } });
			workers.add(this.#worker);
			this.#worker.on('message', data => { this.onmessage?.({ data } as MessageEvent); });
			this.#worker.on('error', error => { this.onerror?.({ error, message: error instanceof Error ? error.message : String(error) } as ErrorEvent); });
		}
		postMessage(message: unknown, transfer: ArrayBuffer[] = []): void { this.#worker.postMessage(message, transfer); }
		addEventListener(type: string, listener: EventListener): void {
			const callback = (value: unknown): void => { listener(type === 'message' ? { data: value } as MessageEvent : { error: value } as ErrorEvent); };
			this.#listeners.set(listener, callback); this.#worker.on(type, callback);
		}
		removeEventListener(type: string, listener: EventListener): void {
			const callback = this.#listeners.get(listener);
			if (callback) this.#worker.off(type, callback);
			this.#listeners.delete(listener);
		}
		terminate(): void { void this.#worker.terminate(); }
	}
	Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: EditorWorker });
	context.after(async () => {
		if (previous) Object.defineProperty(globalThis, 'Worker', previous);
		else Reflect.deleteProperty(globalThis, 'Worker');
		await Promise.all([...workers].map(worker => worker.terminate()));
	});
}
