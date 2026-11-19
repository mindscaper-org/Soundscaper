/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import type { BrowserMacroSandboxOptions } from '../../src/common/editor/macro-script/browser-sandbox.ts';
import { createMacroSandboxClient, type MacroSandboxWorker } from '../../src/common/editor/macro-script/sandbox-client.ts';

const preludeSource = readFileSync(new URL('../../src/common/editor/macro-script/sandbox-prelude.js', import.meta.url), 'utf8');

/** Replace only worker messaging. The shipping client, module builder and prelude still execute. */
export function createBrowserMacroSandbox(options: BrowserMacroSandboxOptions) {
	return createMacroSandboxClient({ ...options, preludeSource,
		createWorker: source => createVmWorker(source),
		setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
		clearTimer: handle => { clearTimeout(handle as ReturnType<typeof setTimeout>); },
	});
}

function createVmWorker(source: string): MacroSandboxWorker {
	let active = true;
	const host = new Map<string, (event: never) => void>();
	const worker = new Map<string, (event: unknown) => void>();
	const context = vm.createContext({ self: {
		postMessage(message: unknown) {
			const data = structuredClone(message);
			queueMicrotask(() => { if (active) host.get('message')?.({ data } as never); });
		},
		addEventListener(type: string, listener: (event: unknown) => void) { worker.set(type, listener); },
	} });
	// The lexical wrapper models an ES module, whose functions are not worker globals.
	// __macroBoot returns its existing promise when called again without a program.
	const boot: unknown = vm.runInContext(`(() => {'use strict';${source}\nreturn globalThis.__macroBoot();})();`, context);
	void Promise.resolve(boot).catch((error: unknown) => {
		if (active) host.get('error')?.({ message: error instanceof Error ? error.message : String(error) } as never);
	});
	return {
		postMessage(message) {
			const data = structuredClone(message);
			queueMicrotask(() => { if (active) worker.get('message')?.({ data }); });
		},
		addEventListener(type, listener) { host.set(type, listener); },
		terminate() { active = false; host.clear(); worker.clear(); },
	};
}
