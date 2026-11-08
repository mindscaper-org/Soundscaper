/* SPDX-License-Identifier: AGPL-3.0-only */

import { setTimeout as delay } from 'node:timers/promises';
import type { Page, TestInfo } from '@playwright/test';

/** Passive evidence for the source-to-main Play handoff; no actions or polling. */
export async function installClipSourceHandoffDiagnostics(page: Page): Promise<void> {
	await page.addInitScript(() => {
		type Primitive = string | number | boolean | null | undefined;
		type Value = Primitive | Value[] | { [name: string]: Value };
		interface EngineSnapshot {
			state: string;
			positionFrame: number;
			pendingPlayRequest: number;
			playRequestSequence: number;
			scrubGeneration: number;
			playbackStartFrame: number;
			playbackStartTime: number;
		}
		interface Fiber {
			memoizedProps?: { controller?: { engine?: EngineSnapshot } };
			return?: Fiber | null;
		}
		type ObservedEvent = Event & { relatedTarget?: EventTarget | null; button?: number; buttons?: number };
		const key = '__scapeSourceHandoffDiagnostic';
		const events: Record<string, Value>[] = [];
		let seen = 0, capturedEvents = 0, collectionErrors = 0;
		const nodeIds = new WeakMap<Element, number>();
		let nextNodeId = 0;
		const describe = (candidate: unknown) => {
			const element = candidate instanceof Element ? candidate : null;
			if (!element) return null;
			if (!nodeIds.has(element)) nodeIds.set(element, ++nextNodeId);
			return {
				nodeId: nodeIds.get(element), isConnected: element.isConnected,
				tag: element.tagName.slice(0, 24),
				id: element.id.slice(0, 80),
				label: element.getAttribute('aria-label')?.slice(0, 96) ?? null,
				classes: element.getAttribute('class')?.slice(0, 120) ?? null,
				disabled: element.matches(':disabled'),
				owner: element.closest('.audio-editor-clip-source-editor, [data-clip-properties-active-clip]') ? 'source'
					: element.closest('.kw-audio-editor__transport') ? 'main' : 'other',
			};
		};
		const snapshot = () => {
			const root = document.querySelector('[data-audio-editor]');
			const fiberKey = root && Object.keys(root).find(name => name.startsWith('__reactFiber$'));
			const properties = root as unknown as Record<string, Fiber | undefined> | null;
			let fiber = fiberKey ? properties?.[fiberKey] : null;
			let engine: EngineSnapshot | null = null;
			for (let depth = 0; fiber && !engine && depth < 32; depth += 1, fiber = fiber.return) {
				engine = fiber.memoizedProps?.controller?.engine ?? null;
			}
			return {
				active: describe(document.activeElement),
				main: describe(document.querySelector('.kw-audio-editor__transport [data-transport="play"] button')),
				source: describe(document.querySelector('.audio-editor-source-ruler__transport button[aria-label="Play"], .audio-editor-source-ruler__transport button[aria-label="Pause"]')),
				transport: engine ? {
					state: engine.state,
					positionFrame: engine.positionFrame,
					pendingPlayRequest: engine.pendingPlayRequest,
					playRequestSequence: engine.playRequestSequence,
					scrubGeneration: engine.scrubGeneration,
					playbackStartFrame: engine.playbackStartFrame,
					playbackStartTime: engine.playbackStartTime,
				} : null,
			};
		};
		const observed = (candidate: unknown) => candidate instanceof Element
			&& candidate.closest('[data-clip-properties-active-clip], .kw-audio-editor__transport');
		const record = (event: ObservedEvent, stage: string) => {
			try {
				if (!observed(event.target) && !observed(event.relatedTarget)) return;
				events.push({
					sequence: ++seen, at: performance.now(), type: event.type, stage,
					phase: event.eventPhase, trusted: event.isTrusted, defaultPrevented: event.defaultPrevented,
					button: 'button' in event ? event.button : null,
					buttons: 'buttons' in event ? event.buttons : null,
					target: describe(event.target),
					targetButton: describe(event.target instanceof Element ? event.target.closest('button') : null),
					related: describe(event.relatedTarget), ...snapshot(),
				});
				capturedEvents++;
				if (events.length > 64) events.shift();
			} catch { collectionErrors++; }
		};
		const listeners: { type: string; listener: EventListener; capture: boolean }[] = [];
		for (const type of ['pointerdown', 'pointerup', 'click', 'focusin', 'focusout']) {
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
		Object.defineProperty(window, key, { configurable: true, value: {
			read,
			dispose: () => {
				for (const { type, listener, capture } of listeners) document.removeEventListener(type, listener, capture);
			},
		} });
	});
}

export async function attachClipSourceHandoffDiagnostics(page: Page, testInfo: TestInfo): Promise<void> {
	const deadline = new AbortController();
	let body: string;
	try {
		body = await Promise.race([
			page.evaluate(() => {
				const ownerWindow = window as Window & { __scapeSourceHandoffDiagnostic?: { read(): string; dispose(): void } };
				const owner = ownerWindow.__scapeSourceHandoffDiagnostic;
				if (!owner) return JSON.stringify({ available: false, reason: 'No diagnostic document remained.', truncated: true, droppedEvents: null });
				try { return owner.read(); }
				finally { owner.dispose(); delete ownerWindow.__scapeSourceHandoffDiagnostic; }
			}),
			delay(1_000, JSON.stringify({ available: false, reason: 'Diagnostic read deadline exceeded.', truncated: true, droppedEvents: null }), { signal: deadline.signal, ref: false }),
		]);
		if (Buffer.byteLength(body) > 32_768) throw new Error('Diagnostic payload exceeded its byte bound.');
		JSON.parse(body);
	} catch (error) {
		body = JSON.stringify({ available: false, error: String(error).slice(0, 512), truncated: true, droppedEvents: null });
	} finally { deadline.abort(); }
	try {
		await testInfo.attach('source-to-main-play-history', { body, contentType: 'application/json' });
	} catch (error) {
		testInfo.annotations.push({ type: 'diagnostic-unavailable', description: String(error).slice(0, 512) });
	}
}
