/* SPDX-License-Identifier: AGPL-3.0-only */

// Platform transport for reviewed repository fixtures, not an untrusted Node sandbox.
import nodeProcess from 'node:process';
import { parentPort, workerData, type Transferable } from 'node:worker_threads';

interface ScopeEvent { readonly data?: unknown; readonly error?: unknown; readonly message?: string; readonly reason?: unknown }
type Listener = (event: ScopeEvent) => void;
export type MacroThreadEntryEvent = ScopeEvent;
const port = parentPort;
if (!port) throw new Error('Macro fixtures require an actual worker MessagePort.');
const listeners = new Map<string, Set<Listener>>();
const emit = (type: string, event: ScopeEvent): boolean => {
	const current = [...listeners.get(type) ?? []];
	for (const listener of current) listener(event);
	return current.length > 0;
};
const failure = (error: unknown): ScopeEvent => ({ error, message: error instanceof Error ? error.message : String(error) });
nodeProcess.on('uncaughtException', error => {
	if (!emit('error', failure(error))) throw error;
});
nodeProcess.on('unhandledRejection', (reason: unknown) => {
	if (!emit('unhandledrejection', { reason })) throw reason instanceof Error ? reason : new Error(String(reason), { cause: reason });
});
Object.defineProperty(globalThis, 'self', { configurable: true, value: {
	postMessage: (data: unknown, transfer: readonly Transferable[] = []) => { port.postMessage(data, [...transfer]); },
	addEventListener(type: string, listener: Listener) {
		if (!['message', 'error', 'unhandledrejection'].includes(type)) throw new Error(`Unsupported macro scope event: ${type}`);
		let current = listeners.get(type);
		if (!current) {
			current = new Set(); listeners.set(type, current);
			// Retain the actual MessagePort queue until the shipping prelude subscribes.
			if (type === 'message') port.on('message', (data: unknown) => { emit('message', { data }); });
		}
		current.add(listener);
	},
	removeEventListener(type: string, listener: Listener) { listeners.get(type)?.delete(listener); },
} });
const data: unknown = workerData;
if (!data || typeof data !== 'object' || !('moduleUrl' in data) || typeof data.moduleUrl !== 'string')
	throw new TypeError('An authored macro module URL is required.');
try { await import(data.moduleUrl); }
catch (error) { if (!emit('error', failure(error))) throw error; }
