/* SPDX-License-Identifier: AGPL-3.0-only */

import { setTimeout as delay } from 'node:timers/promises';
import type { Page, TestInfo } from '@playwright/test';

type DiagnosticWindow = Window & { __scapeTempoInputDiagnostics?: () => string };

/** Observe the original keyboard interaction without changing focus or default handling. */
export async function installTempoInputDiagnostics(page: Page): Promise<void> {
	await page.addInitScript(() => {
		if (window !== window.top) return;
		const selector = '[data-action-id="playback-bpm"] input[type="number"]';
		const ids = new WeakMap<Element, number>();
		const records: { event: Event; entry: Record<string, unknown> }[] = [];
		let nextId = 0, totalEvents = 0, collectionErrors = 0;
		const clip = (value: unknown) => String(value ?? '').slice(0, 32);
		const isTempo = (target: EventTarget | null) => target instanceof Element && target.matches(selector);
		const nodeInfo = (target: EventTarget | null) => {
			if (!(target instanceof Element)) return null;
			if (!ids.has(target) && nextId < 256) ids.set(target, ++nextId);
			return { id: ids.get(target) ?? null, tag: clip(target.tagName), connected: target.isConnected, tempo: isTempo(target) };
		};
		const selection = (input: HTMLInputElement | null) => {
			const unsupported = { status: 'unsupported', start: null, end: null, direction: null };
			if (!input) return unsupported;
			try {
				const start = input.selectionStart, end = input.selectionEnd;
				return start === null || end === null ? unsupported
					: { status: 'supported', start, end, direction: input.selectionDirection };
			} catch { return unsupported; }
		};
		const capture = (event: Event) => {
			try {
				const related = event instanceof FocusEvent ? event.relatedTarget : null;
				if (!isTempo(event.target) && !isTempo(document.activeElement) && !isTempo(related)) return;
				const input = document.querySelector<HTMLInputElement>(selector);
				const keyboard = event instanceof KeyboardEvent ? event : null;
				const edit = event instanceof InputEvent ? event : null;
				totalEvents++;
				records.push({ event, entry: {
					sequence: totalEvents, at: performance.now(), type: event.type, trusted: event.isTrusted,
					defaultPreventedAtCapture: event.defaultPrevented,
					target: nodeInfo(event.target), active: nodeInfo(document.activeElement), related: nodeInfo(related), field: nodeInfo(input),
					documentFocused: document.hasFocus(), visibility: document.visibilityState,
					value: input ? clip(input.value) : null, defaultValue: input ? clip(input.defaultValue) : null,
					tabIndex: input?.tabIndex ?? null, disabled: input?.disabled ?? null, selection: selection(input),
					key: keyboard ? { key: clip(keyboard.key), code: clip(keyboard.code), ctrl: keyboard.ctrlKey,
						meta: keyboard.metaKey, alt: keyboard.altKey, shift: keyboard.shiftKey, repeat: keyboard.repeat, composing: keyboard.isComposing } : null,
					input: edit ? { type: clip(edit.inputType), data: clip(edit.data), composing: edit.isComposing } : null,
				} });
				if (records.length > 64) records.shift();
			} catch { collectionErrors++; }
		};
		for (const type of ['focusin', 'focusout', 'keydown', 'keyup', 'beforeinput', 'input', 'change']) {
			window.addEventListener(type, capture, { capture: true, passive: true });
		}
		Object.defineProperty(window, '__scapeTempoInputDiagnostics', { value: () => {
			// Keep Event refs only in the bounded ring: read cancellation after dispatch settles.
			const events = records.map(({ event, entry }) => ({ ...entry, defaultPreventedFinal: event.defaultPrevented }));
			let body: string;
			do {
				body = JSON.stringify({ totalEvents, droppedEvents: totalEvents - events.length, collectionErrors, nodeIdLimitReached: nextId === 256, events });
				if (new TextEncoder().encode(body).byteLength <= 32_768) return body;
				events.shift();
			} while (events.length);
			return JSON.stringify({ error: 'Tempo diagnostic payload exceeded its byte bound.' });
		} });
	});
}

/** A failed read gets one small attachment; a late read can never attach after this hook. */
export async function attachTempoInputDiagnostics(page: Page, testInfo: Pick<TestInfo, 'status' | 'expectedStatus' | 'attach'>): Promise<void> {
	if (testInfo.status === testInfo.expectedStatus) return;
	const deadline = new AbortController();
	let body: string;
	try {
		body = await Promise.race([
			page.evaluate(() => (window as DiagnosticWindow).__scapeTempoInputDiagnostics?.()
				?? JSON.stringify({ error: 'Tempo recorder was unavailable.' })),
			delay(1_000, JSON.stringify({ error: 'Tempo diagnostic read deadline exceeded.' }), { signal: deadline.signal, ref: false }),
		]);
		if (Buffer.byteLength(body) > 32_768) throw new Error('Tempo diagnostic payload exceeded its byte bound.');
		JSON.parse(body);
	} catch (error) {
		body = JSON.stringify({ error: String(error).slice(0, 512) });
	} finally { deadline.abort(); }
	await testInfo.attach('tempo-input-diagnostics', { body, contentType: 'application/json' }).catch(() => undefined);
}
