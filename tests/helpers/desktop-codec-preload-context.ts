/* SPDX-License-Identifier: AGPL-3.0-only */

import vm from 'node:vm';
import { readDesktopPreloadSource } from './desktop-preload-source.mjs';

/** Model Electron's contextBridge and IPC record copies into the preload realm. */
export async function desktopCodecPreloadContext<Bridge>(
	invoke: (channel: string, value: unknown) => Promise<unknown>,
): Promise<Bridge> {
	let exposed: { v1: Record<string, (...args: unknown[]) => Promise<unknown>> } | undefined;
	const context = vm.createContext({
		AbortSignal, ArrayBuffer, Float32Array, Promise, RangeError, String, TypeError, Uint8Array, URL,
		require: () => ({
			contextBridge: { exposeInMainWorld(name: string, value: typeof exposed) {
				if (name === 'soundscaperDesktop') exposed = value;
			} },
			ipcRenderer: {
				invoke: async (channel: string, value: unknown) => transfer(await invoke(channel, structuredClone(value))),
				send() {}, on() {}, removeListener() {},
			},
		}),
	});
	const transfer = vm.runInContext(`(function copy(value) {
		if (!value || typeof value !== 'object' || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
		if (Array.isArray(value)) return Array.from(value, copy);
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, copy(entry)]));
	})`, context) as (value: unknown) => unknown;
	vm.runInContext(await readDesktopPreloadSource(), context);
	if (!exposed) throw new Error('Missing desktop preload bridge');
	return Object.fromEntries(Object.entries(exposed.v1).map(([name, method]) => [name,
		(...args: unknown[]) => method(...args.map(transfer)),
	])) as Bridge;
}
