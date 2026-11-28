/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TestContext } from 'node:test';
import { JSDOM } from 'jsdom';

import { deferred } from './async-test-control.ts';

export function browserFixture(context: TestContext, embedded = false, prompt: () => string | null = () => embedded ? null : 'Working project') {
	const { window } = new JSDOM('<!doctype html><body></body>');
	const chooser = deferred<HTMLDialogElement>();
	Object.defineProperty(window.HTMLDialogElement.prototype, 'showModal', {
		value(this: HTMLDialogElement) { this.open = true; chooser.resolve(this); },
	});
	Object.defineProperty(window.HTMLDialogElement.prototype, 'close', {
		value(this: HTMLDialogElement, value: string) {
			this.open = false;
			this.returnValue = value;
			this.dispatchEvent(new window.Event('close'));
		},
	});
	const deadlines = new Map<number, () => void>();
	let sequence = 0;
	const bindings = {
		document: window.document,
		window: {
			self: window,
			top: embedded ? {} : window,
			prompt,
			setTimeout(callback: () => void): number {
				const id = ++sequence;
				deadlines.set(id, callback);
				return id;
			},
			clearTimeout(id: number): void { deadlines.delete(id); },
		},
	};
	installGlobals(context, bindings);
	context.after(() => window.close());
	return { window, deadlines, chooser: chooser.promise };
}

export function installGlobals(context: TestContext, values: Readonly<Record<string, unknown>>): void {
	for (const [key, value] of Object.entries(values)) {
		const previous = Object.getOwnPropertyDescriptor(globalThis, key);
		Object.defineProperty(globalThis, key, { configurable: true, value });
		context.after(() => {
			if (previous) Object.defineProperty(globalThis, key, previous);
			else Reflect.deleteProperty(globalThis, key);
		});
	}
}
