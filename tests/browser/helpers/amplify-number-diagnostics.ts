/* SPDX-License-Identifier: AGPL-3.0-only */

import { setTimeout as delay } from 'node:timers/promises';
import type { Page, TestInfo } from '@playwright/test';

/** Passive native-event and value-attribute evidence for the Amplify gain input. */
export async function installAmplifyNumberDiagnostics(page: Page): Promise<void> {
	await page.addInitScript(() => {
		type Primitive = string | number | boolean | null | undefined;
		type Value = Primitive | Value[] | { [name: string]: Value };
		type ObservedEvent = Event & { key?: string; inputType?: string; data?: string | null };
		const events: Record<string, Value>[] = [];
		const nodes = new WeakMap<Element, number>();
		let seen = 0, nextNode = 0, capturedEvents = 0, collectionErrors = 0;
		let observedFieldId: number | null = null;
		const fieldSelector = '[data-selection-effects-dialog] [data-effect-param="gainDb"]';
		const short = (value: unknown, maximum = 96) => typeof value === 'string' ? value.slice(0, maximum) : null;
		const describe = (element: unknown) => {
			if (!(element instanceof Element)) return null;
			if (!nodes.has(element)) nodes.set(element, ++nextNode);
			return { nodeId: nodes.get(element), isConnected: element.isConnected, tag: element.tagName,
				type: short(element.getAttribute('type'), 24), label: short(element.getAttribute('aria-label')) };
		};
		const snapshot = () => {
			const field = document.querySelector(fieldSelector);
			const input = field?.querySelector<HTMLInputElement>('input[type="number"]');
			const range = field?.querySelector<HTMLInputElement>('input[type="range"]');
			return { input: describe(input), active: describe(document.activeElement),
				documentFocused: document.hasFocus(), visibility: document.visibilityState,
				draft: short(input?.value), valueAttribute: short(input?.getAttribute('value')),
				badInput: input?.validity.badInput ?? null, invalid: short(input?.getAttribute('aria-invalid'), 12),
				selectionStart: input?.selectionStart ?? null, selectionEnd: input?.selectionEnd ?? null,
				selectionDirection: input?.selectionDirection ?? null,
				range: describe(range), rangeValue: short(range?.value), rangeAttribute: short(range?.getAttribute('value')) };
		};
		const append = (row: Record<string, Value>) => {
			events.push({ sequence: ++seen, at: performance.now(), ...row, ...snapshot() });
			capturedEvents++;
			if (events.length > 64) events.shift();
		};
		// Controlled value changes need not emit input. Observe only the gain
		// field acquired at the first relevant native event, never the whole body.
		const observer = new MutationObserver(records => {
			for (const mutation of records) {
				try { append({ type: 'value-attribute', stage: 'observer',
					target: describe(mutation.target), oldValue: short(mutation.oldValue),
					attributeValue: short((mutation.target as Element).getAttribute('value')) }); }
				catch { collectionErrors++; }
			}
		});
		const record = (event: ObservedEvent, stage: string) => {
			try {
				const field = event.target instanceof Element ? event.target.closest(fieldSelector) : null;
				if (!field) return;
				const fieldId = describe(field)!.nodeId!;
				if (fieldId !== observedFieldId) {
					observer.disconnect(); observedFieldId = fieldId;
					observer.observe(field, { subtree: true, attributes: true, attributeFilter: ['value'], attributeOldValue: true });
				}
				append({ type: event.type, stage, phase: event.eventPhase, trusted: event.isTrusted,
					defaultPrevented: event.defaultPrevented, target: describe(event.target),
					key: short(event.key, 24), inputType: short(event.inputType, 64), data: short(event.data, 64) });
			} catch { collectionErrors++; }
		};
		const listeners: { type: string; listener: EventListener; capture: boolean }[] = [];
		for (const type of ['focusin', 'focusout', 'select', 'keydown', 'beforeinput', 'input', 'change']) {
			for (const capture of [true, false]) {
				const listener = (event: Event) => record(event, capture ? 'capture' : 'bubble');
				document.addEventListener(type, listener, { capture, passive: true });
				listeners.push({ type, listener, capture });
			}
		}
		const read = (): string => {
			let final: ReturnType<typeof snapshot> | null = null;
			try { final = snapshot(); } catch { collectionErrors++; }
			const retained = [...events];
			const unavailable = (reason: string) => JSON.stringify({ available: false, reason,
				seen, capturedEvents, retainedEvents: 0, droppedEvents: capturedEvents,
				collectionErrors, capacity: 64, byteLimit: 32_768, truncated: true });
			for (;;) {
				try {
					const droppedEvents = capturedEvents - retained.length;
					const body = JSON.stringify({ available: true, seen, capturedEvents,
						retainedEvents: retained.length, droppedEvents,
						ringDroppedEvents: capturedEvents - events.length,
						payloadDroppedEvents: events.length - retained.length,
						collectionErrors, capacity: 64, byteLimit: 32_768,
						truncated: droppedEvents > 0 || collectionErrors > 0, events: retained, final });
					if (new TextEncoder().encode(body).byteLength <= 32_768) return body;
				} catch { collectionErrors++; return unavailable('Diagnostic serialization failed.'); }
				if (!retained.length) return unavailable('Diagnostic payload exceeded its byte bound.');
				retained.shift();
			}
		};
		Object.defineProperty(window, '__scapeEffectNumberDiagnostic', { configurable: true, value: {
			read,
			dispose: () => {
				observer.disconnect();
				for (const { type, listener, capture } of listeners) document.removeEventListener(type, listener, capture);
			},
		} });
	});
}

export async function attachAmplifyNumberDiagnostics(page: Page, testInfo: TestInfo): Promise<void> {
	const deadline = new AbortController();
	let body: string;
	try {
		body = await Promise.race([
			page.evaluate(() => {
				const ownerWindow = window as Window & { __scapeEffectNumberDiagnostic?: { read(): string; dispose(): void } };
				const owner = ownerWindow.__scapeEffectNumberDiagnostic;
				if (!owner) return JSON.stringify({ available: false, reason: 'No diagnostic document remained.', truncated: true, droppedEvents: null });
				try { return owner.read(); }
				finally { owner.dispose(); delete ownerWindow.__scapeEffectNumberDiagnostic; }
			}),
			delay(1_000, JSON.stringify({ available: false, reason: 'Diagnostic read deadline exceeded.', truncated: true, droppedEvents: null }), { signal: deadline.signal, ref: false }),
		]);
		if (Buffer.byteLength(body) > 32_768) throw new Error('Diagnostic payload exceeded its byte bound.');
		JSON.parse(body);
	} catch (error) {
		body = JSON.stringify({ available: false, error: String(error).slice(0, 512), truncated: true, droppedEvents: null });
	} finally { deadline.abort(); }
	try {
		await testInfo.attach('amplify-number-event-history', { body, contentType: 'application/json' });
	} catch (error) {
		testInfo.annotations.push({ type: 'diagnostic-unavailable', description: String(error).slice(0, 512) });
	}
}
