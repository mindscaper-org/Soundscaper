/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

import { createNodeWebAudioEngineFactory } from './node-web-audio-engine.ts';

type ReactRuntime = typeof import('react');

/** Real DOM events and React delegation; CSS, layout and native storage remain browser coverage. */
export async function createEditorRootDom(context: TestContext) {
	const errors: unknown[] = [];
	const virtualConsole = new VirtualConsole();
	virtualConsole.on('jsdomError', (error: unknown) => { errors.push(error); });
	const host = new JSDOM('<!doctype html><html><body></body></html>', {
		url: 'http://localhost/embed/en/', pretendToBeVisual: true, virtualConsole,
	});
	const window = host.window;
	const scrollRequests: { readonly element: Element; readonly options: boolean | ScrollIntoViewOptions | undefined }[] = [];
	// JSDOM has no layout or scrollIntoView implementation. Retain the actual
	// requested node/options without inventing geometry or moving/focusing it.
	// Dropdown keyboard scrolling and placement stay in native browser coverage.
	Object.defineProperty(window.Element.prototype, 'scrollIntoView', {
		configurable: true,
		value(this: Element, options?: boolean | ScrollIntoViewOptions): void {
			assert.ok(this instanceof window.Element && this.isConnected);
			scrollRequests.push({ element: this, options });
		},
	});
	const descriptors = new Map<string, PropertyDescriptor | undefined>();
	const owners: (() => Promise<void>)[] = [];
	let react: ReactRuntime | undefined;
	let audio: ReturnType<typeof createNodeWebAudioEngineFactory> | undefined;
	let disposal: Promise<void> | undefined;
	const dispose = (): Promise<void> => disposal ??= (async () => {
		const failures: unknown[] = [];
		for (const retire of [...owners].reverse()) {
			try { await retire(); } catch (error) { failures.push(error); }
		}
		try { await audio?.dispose(); } catch (error) { failures.push(error); }
		try { window.close(); } catch (error) { failures.push(error); }
		for (const [name, descriptor] of [...descriptors].reverse()) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else Reflect.deleteProperty(globalThis, name);
		}
		if (failures.length) throw new AggregateError(failures, 'Editor DOM owner cleanup failed.');
	})();
	context.after(dispose);
	const publish = (name: string, value: unknown): void => {
		descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
	};
	try {
		for (const name of [
			'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
			'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement',
			'HTMLIFrameElement', 'HTMLCanvasElement', 'HTMLMediaElement', 'HTMLAudioElement', 'SVGElement',
			'Document', 'DocumentFragment', 'MutationObserver', 'Event', 'EventTarget', 'MouseEvent',
			'KeyboardEvent', 'CustomEvent', 'FocusEvent', 'DOMException', 'AbortController', 'AbortSignal',
		]) publish(name, name === 'window' ? window : Reflect.get(window, name));
		for (const name of ['requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle',
			'addEventListener', 'removeEventListener', 'dispatchEvent']) {
			const operation: unknown = Reflect.get(window, name);
			assert.equal(typeof operation, 'function');
			publish(name, (operation as (...args: unknown[]) => unknown).bind(window));
		}
		publish('IS_REACT_ACT_ENVIRONMENT', true);
		// ReactDOM must first initialize with the actual realm's delegated event host.
		react = await import('react');
		publish('React', react);
		audio = createNodeWebAudioEngineFactory(context);
		for (const name of ['AudioContext', 'OfflineAudioContext', 'AudioWorkletNode', 'AudioBuffer',
			'AudioNode', 'AudioParam', 'AudioBufferSourceNode', 'BaseAudioContext']) {
			Object.defineProperty(window, name, { configurable: true, value: Reflect.get(globalThis, name) });
		}
	} catch (error) { await dispose(); throw error; }
	const reactRuntime = react;
	assert.ok(reactRuntime);
	const wait = async (predicate: () => boolean | Promise<boolean>, message: string): Promise<void> => {
		const deadline = performance.now() + 5_000;
		while (performance.now() < deadline) {
			if (await predicate()) return;
			await reactRuntime.act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
		}
		assert.ok(await predicate(), message);
	};
	const element = (selector: string, root: ParentNode = window.document): HTMLElement => {
		const node = root.querySelector(selector);
		assert.ok(node instanceof window.HTMLElement, `Missing actual DOM element: ${selector}`);
		return node;
	};
	const byText = (selector: string, text: string | RegExp, root: ParentNode = window.document): HTMLElement => {
		const node = [...root.querySelectorAll(selector)].find(candidate => {
			const value = candidate.textContent?.trim() ?? '';
			return typeof text === 'string' ? value === text : text.test(value);
		});
		assert.ok(node instanceof window.HTMLElement, `Missing actual ${selector}: ${String(text)}`);
		return node;
	};
	const click = async (node: HTMLElement): Promise<void> => {
		await reactRuntime.act(async () => { node.click(); });
	};
	const setValue = async (input: HTMLInputElement, value: string): Promise<void> => {
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
		assert.ok(setter);
		await reactRuntime.act(async () => {
			input.focus();
			setter.call(input, value);
			input.dispatchEvent(new window.Event('input', { bubbles: true }));
		});
	};
	const assertHealthy = (): void => {
		// No optional native canvas is installed. The shipping null-context fallback
		// runs unchanged; no geometry, canvas method, observer or readiness is replaced.
		const canvasOmission = /Not implemented: (?:HTMLCanvasElement(?:\.prototype)?\.getContext|HTMLCanvasElement's getContext)/u;
		assert.deepEqual(errors.map(String).filter(error => !canvasOmission.test(error)), []);
		const boundaries = [...window.document.querySelectorAll(
			'[data-editor-surface-error], [data-audio-editor-bound="false"]',
		)];
		assert.equal(boundaries.length, 0, boundaries.map(node => node.textContent).join('\n'));
	};
	return {
		window, document: window.document, react: reactRuntime, element, byText, wait, click, setValue,
		assertHealthy, dispose, scrollRequests: scrollRequests as readonly (typeof scrollRequests[number])[],
		onDispose(retire: () => Promise<void>): void { owners.push(retire); },
		async key(node: HTMLElement, key: string): Promise<void> {
			await reactRuntime.act(async () => {
				node.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
			});
		},
	};
}

export type EditorRootDom = Awaited<ReturnType<typeof createEditorRootDom>>;
