/* SPDX-License-Identifier: AGPL-3.0-only */

import { setTimeout as delay } from 'node:timers/promises';
import type { Page, TestInfo } from '@playwright/test';

type MenuDiagnosticScope = Readonly<{ menu: 'Edit' | 'View'; branch: 'Paste' | 'Zoom' }>;

/** Observe native menu input and DOM identity; never dispatch, cancel or refocus. */
export async function installMenuKeyboardDiagnostics(page: Page, scope: MenuDiagnosticScope): Promise<void> {
	await page.addInitScript((scope) => {
		if (window !== window.top) return;
		type Value = string | number | boolean | null | undefined | Value[] | { [key: string]: Value };
		type Row = Record<string, Value>;
		const rootSelector = '.kw-audio-editor__application-menu[role="menu"]';
		const itemSelector = '[role="menuitem"], [role="menuitemcheckbox"]';
		const records: { event: Event | null; entry: Row }[] = [];
		const ids = new WeakMap<Element, number>();
		let nextId = 0, seen = 0, errors = 0, mutationRecordsOmitted = 0, mutationNodesOmitted = 0;
		let openings = 0, branchArrows = 0, leafEnters = 0, unavailableParent = 0, lateRootAcquisitions = 0;
		let mutationCallbacks = 0, mutationObservationStopped = false, unattributedRootTransitions = 0;
		let header: Element | null = null, root: Element | null = null;
		const short = (value: string | null) => value?.slice(0, 64) ?? null;
		const label = (element: Element | null) => short(element?.getAttribute('aria-label')
			?? (element?.matches('.context-menu-item')
				? element.querySelector(':scope > .context-menu-item-content > .context-menu-item-label')?.textContent ?? null
				: element?.closest('[role="menubar"]') ? element.textContent : null));
		const id = (element: Element) => {
			if (!ids.has(element) && nextId < 256) ids.set(element, ++nextId);
			return ids.get(element) ?? null;
		};
		const describe = (candidate: unknown): Row | null => {
			if (!(candidate instanceof Element)) return null;
			return { id: id(candidate), connected: candidate.isConnected, tag: candidate.tagName,
				role: short(candidate.getAttribute('role')), label: label(candidate),
				disabled: short(candidate.getAttribute('aria-disabled')), expanded: short(candidate.getAttribute('aria-expanded')),
				hidden: candidate.hasAttribute('hidden'), ariaHidden: short(candidate.getAttribute('aria-hidden')) };
		};
		const append = (entry: Row, event: Event | null = null) => {
			records.push({ event, entry: { sequence: ++seen, at: performance.now(), openings, branchArrows, leafEnters, ...entry } });
			if (records.length > 64) records.shift();
		};
		const knownRoot = (candidate: Element) => candidate.matches(rootSelector)
			&& (candidate.getAttribute('aria-label') === scope.menu || (!candidate.getAttribute('aria-label') && candidate === root));
		const selectedRoot = (candidate: Element) => knownRoot(candidate) || (candidate.matches(rootSelector)
			&& candidate.isConnected && !candidate.getAttribute('aria-label')
			&& label(header?.querySelector('[role="menubar"] [aria-expanded="true"]') ?? null) === scope.menu);
		const directMenu = (element: Element): Element | null => {
			if (element.matches(rootSelector)) return element;
			mutationNodesOmitted += Math.max(0, element.children.length - 3);
			for (let index = 0; index < Math.min(3, element.children.length); index++) {
				if (element.children[index].matches(rootSelector)) return element.children[index];
			}
			return null;
		};
		const admitMutationCallback = (count: number): boolean => {
			if (!mutationObservationStopped && mutationCallbacks++ < 256) return true;
			mutationRecordsOmitted += count;
			if (!mutationObservationStopped) {
				mutationObservationStopped = true; treeObserver.disconnect(); headerObserver.disconnect();
				append({ kind: 'mutation-observation-budget-exhausted' });
			}
			return false;
		};
		const boundedMenuNodes = (nodes: NodeList): Row[] => {
			const result: Row[] = [];
			mutationNodesOmitted += Math.max(0, nodes.length - 8);
			for (let index = 0; index < Math.min(8, nodes.length); index++) {
				const node = nodes[index];
				if (node instanceof Element && node.matches('[role="menu"]')) result.push(describe(node)!);
			}
			return result;
		};
		const treeObserver = new MutationObserver((mutations) => {
			if (!admitMutationCallback(mutations.length)) return;
			mutationRecordsOmitted += Math.max(0, mutations.length - 32);
			for (let index = 0; index < Math.min(32, mutations.length); index++) {
				try {
					const change = mutations[index];
					append({ kind: 'menu-mutation', type: change.type, root: describe(root), target: describe(change.target),
						attribute: change.attributeName, oldValue: short(change.oldValue),
						addedMenus: boundedMenuNodes(change.addedNodes), removedMenus: boundedMenuNodes(change.removedNodes) });
				} catch { errors++; }
			}
		});
		const bindRoot = (candidate: Element) => {
			if (mutationObservationStopped || !selectedRoot(candidate) || candidate === root) return;
			mutationRecordsOmitted += treeObserver.takeRecords().length;
			treeObserver.disconnect(); root = candidate;
			treeObserver.observe(candidate, { subtree: true, childList: true, attributes: true,
				attributeFilter: ['class', 'aria-label', 'aria-disabled', 'aria-expanded', 'aria-hidden', 'hidden'], attributeOldValue: true });
		};
		const headerObserver = new MutationObserver((mutations) => {
			if (!admitMutationCallback(mutations.length)) return;
			mutationRecordsOmitted += Math.max(0, mutations.length - 32);
			for (let index = 0; index < Math.min(32, mutations.length); index++) {
				const change = mutations[index];
				for (const [kind, nodes] of [['menu-removed', change.removedNodes], ['menu-added', change.addedNodes]] as const) {
					mutationNodesOmitted += Math.max(0, nodes.length - 8);
					for (let nodeIndex = 0; nodeIndex < Math.min(8, nodes.length); nodeIndex++) {
						try {
							const node = nodes[nodeIndex];
							if (!(node instanceof Element)) continue;
							const menu = directMenu(node);
							if (!menu) continue;
							const attributed = kind === 'menu-removed' ? knownRoot(menu) : selectedRoot(menu);
							if (!attributed) {
								if (!menu.getAttribute('aria-label')) {
									unattributedRootTransitions++;
									append({ kind: `unattributed-${kind}`, wrapper: describe(node), menu: describe(menu) });
								}
								continue;
							}
							if (kind === 'menu-added') { openings++; bindRoot(menu); }
							else if (menu === root) {
								mutationRecordsOmitted += treeObserver.takeRecords().length;
								treeObserver.disconnect(); root = null;
							}
							append({ kind, wrapper: describe(node), menu: describe(menu) });
						} catch { errors++; }
					}
				}
			}
		});
		const acquire = (element: Element) => {
			if (mutationObservationStopped) return;
			const candidate = element.closest('header.kw-audio-editor__application-header');
			if (!candidate || candidate === document.body) { unavailableParent++; return; }
			if (header !== candidate) {
				mutationRecordsOmitted += headerObserver.takeRecords().length;
				append({ kind: 'header-acquired', priorHeader: describe(header), header: describe(candidate) });
				headerObserver.disconnect(); header = candidate;
				// Only direct wrapper removal/insertion: never the body/editor subtree.
				headerObserver.observe(candidate, { childList: true });
			}
			mutationNodesOmitted += Math.max(0, candidate.children.length - 8);
			for (let index = 0; index < Math.min(8, candidate.children.length); index++) {
				const menu = directMenu(candidate.children[index]);
				if (!menu || !selectedRoot(menu)) continue;
				if (menu !== root) { lateRootAcquisitions++; bindRoot(menu); append({ kind: 'late-root-acquired', menu: describe(menu) }); }
				break;
			}
		};
		const relevant = (candidate: EventTarget | null): Element | null => {
			if (!(candidate instanceof Element)) return null;
			const trigger = candidate.closest('[role="menubar"] [role="menuitem"]');
			if (trigger && label(trigger)?.trim() === scope.menu) return candidate;
			const menu = candidate.closest(rootSelector);
			return menu && knownRoot(menu) ? candidate : null;
		};
		const observe = (event: Event, stage: string) => {
			try {
				const related = event instanceof FocusEvent ? event.relatedTarget : null;
				const target = relevant(event.target), relatedElement = relevant(related);
				const outsideMenuKey = !target && !relatedElement && event instanceof KeyboardEvent
					&& root?.isConnected === true && ['Enter', 'ArrowRight'].includes(event.key);
				if (!target && !relatedElement && !outsideMenuKey) return;
				if (target || relatedElement) acquire(target ?? relatedElement!);
				const item = target?.closest(itemSelector) ?? null;
				const parent = item?.parentElement?.closest('.context-menu-item') ?? null;
				const keyboard = event instanceof KeyboardEvent ? event : null;
				if (stage === 'capture' && event.type === 'keydown') {
					if (keyboard?.key === 'ArrowRight' && label(item)?.trim() === scope.branch) branchArrows++;
					if (keyboard?.key === 'Enter' && label(parent)?.trim() === scope.branch) leafEnters++;
				}
				append({ kind: 'native-event', type: event.type, stage, phase: event.eventPhase, trusted: event.isTrusted,
					defaultPreventedAtObservation: event.defaultPrevented, outsideMenuKey, target: describe(event.target),
					item: describe(item), parentItem: describe(parent), nearestMenu: describe(target?.closest('[role="menu"]')),
					active: describe(document.activeElement), related: describe(related), documentFocused: document.hasFocus(),
					visibility: document.visibilityState, key: short(keyboard?.key ?? null), code: short(keyboard?.code ?? null),
					ctrl: keyboard?.ctrlKey ?? null, meta: keyboard?.metaKey ?? null, alt: keyboard?.altKey ?? null,
					shift: keyboard?.shiftKey ?? null, repeat: keyboard?.repeat ?? null }, event);
			} catch { errors++; }
		};
		const listeners: { type: string; listener: EventListener; capture: boolean }[] = [];
		for (const type of ['keydown', 'keyup', 'focusin', 'focusout']) for (const capture of [true, false]) {
			const listener = (event: Event) => observe(event, capture ? 'capture' : 'bubble');
			window.addEventListener(type, listener, { capture, passive: true });
			listeners.push({ type, listener, capture });
		}
		for (const type of ['focus', 'blur']) {
			const listener: EventListener = event => {
				if (event.target !== window || !root?.isConnected) return;
				append({ kind: 'window-focus', type, active: describe(document.activeElement),
					documentFocused: document.hasFocus(), visibility: document.visibilityState });
			};
			window.addEventListener(type, listener, { passive: true });
			listeners.push({ type, listener, capture: false });
		}
		const read = (): string => {
			const retained = records.map(({ event, entry }) => ({ ...entry,
				defaultPreventedFinal: event?.defaultPrevented ?? null,
				targetConnectedFinal: event?.target instanceof Node ? event.target.isConnected : null }));
			for (;;) {
				const body = JSON.stringify({ scope, seen, droppedRecords: seen - retained.length, collectionErrors: errors,
					capacity: 64, nodeCapacity: 256, nodeCapacityReached: nextId === 256, byteLimit: 32_768,
					mutationRecordsOmitted, mutationNodesOmitted, mutationCallbacks, mutationCallbackLimit: 256, mutationObservationStopped,
					unavailableParent, lateRootAcquisitions, unattributedRootTransitions, openings, branchArrows, leafEnters,
					final: { header: describe(header), root: describe(root), active: describe(document.activeElement),
						documentFocused: document.hasFocus(), visibility: document.visibilityState }, records: retained });
				if (new TextEncoder().encode(body).byteLength <= 32_768) return body;
				if (!retained.length) return JSON.stringify({ available: false, reason: 'Menu diagnostic exceeded its byte bound.' });
				retained.shift();
			}
		};
		Object.defineProperty(window, '__scapeMenuKeyboardDiagnostics', { configurable: true, value: { read, dispose: () => {
			treeObserver.disconnect(); headerObserver.disconnect();
			for (const { type, listener, capture } of listeners) window.removeEventListener(type, listener, capture);
			records.length = 0; root = null; header = null;
		} } });
	}, scope);
}

/** One bounded failure-time read; no successful test performs a browser read. */
export async function attachMenuKeyboardDiagnostics(page: Page, testInfo: Pick<TestInfo, 'status' | 'expectedStatus' | 'attach'>): Promise<void> {
	if (testInfo.status === testInfo.expectedStatus) return;
	const deadline = new AbortController();
	let body: string;
	try {
		body = await Promise.race([
			page.evaluate(() => {
				const ownerWindow = window as Window & { __scapeMenuKeyboardDiagnostics?: { read(): string; dispose(): void } };
				const owner = ownerWindow.__scapeMenuKeyboardDiagnostics;
				if (!owner) return JSON.stringify({ available: false, reason: 'No menu recorder remained.' });
				try { return owner.read(); }
				finally { owner.dispose(); delete ownerWindow.__scapeMenuKeyboardDiagnostics; }
			}),
			delay(1_000, JSON.stringify({ available: false, reason: 'Menu diagnostic read deadline exceeded.' }), { signal: deadline.signal, ref: false }),
		]);
		if (Buffer.byteLength(body) > 32_768) throw new Error('Menu diagnostic exceeded its byte bound.');
		JSON.parse(body);
	} catch (error) {
		body = JSON.stringify({ available: false, error: String(error).slice(0, 512) });
	} finally { deadline.abort(); }
	await testInfo.attach('menu-keyboard-diagnostics', { body, contentType: 'application/json' }).catch(() => undefined);
}
