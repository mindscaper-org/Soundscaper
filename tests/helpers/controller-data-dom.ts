/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import assert from 'node:assert/strict';
import { installReactTestDom } from './react-test-dom.ts';

/** Supply only DOM hosting; controller state, commands and persistence remain the product owners. */
export function mountControllerDataDom() {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const root = createRoot(dom.container as unknown as Element);
	let pending: Promise<unknown> | undefined;
	return { dom,
		run(operation: () => unknown): Promise<unknown> { pending = Promise.resolve().then(operation); return pending; },
		async settle(): Promise<void> { await pending; },
		async render(node: ReactNode): Promise<void> { await act(async () => { root.render(node); }); },
		async dispose(): Promise<void> {
			try { await act(async () => { await pending; root.unmount(); }); }
			finally {
				dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
				if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
			}
		},
	};
}

/** Await the real subscribed publication without repeating the UI's command in the test. */
export async function waitForControllerDataState<State>(port: Readonly<{
	getSnapshot(): State; subscribe(listener: () => void): () => void;
}>, predicate: (state: State) => boolean, message: string): Promise<void> {
	if (predicate(port.getSnapshot())) return;
	await new Promise<void>((resolve, reject) => {
		let unsubscribe: () => void = () => undefined;
		const timer = setTimeout(() => {
			unsubscribe();
			try { assert.ok(predicate(port.getSnapshot()), message); resolve(); } catch (cause) { reject(cause); }
		}, 5_000);
		const check = () => {
			if (!predicate(port.getSnapshot())) return;
			clearTimeout(timer); unsubscribe(); resolve();
		};
		unsubscribe = port.subscribe(check);
		check();
	});
}
