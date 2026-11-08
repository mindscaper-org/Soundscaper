/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { useTimelineNavigation } from '../src/common/editor/ui/workspace/useTimelineNavigation.js';
import { installReactTestDom, ReactTestElement } from './helpers/react-test-dom.ts';

const cases = [
	{ name: 'claimed local Ctrl zoom', ctrlKey: true, claimed: true, expected: null },
	{ name: 'claimed local Meta zoom', metaKey: true, claimed: true, expected: null },
	{ name: 'ordinary main Ctrl zoom in', ctrlKey: true, expected: 'in' },
	{ name: 'ordinary main Meta zoom in', metaKey: true, expected: 'in' },
	{ name: 'ordinary main Ctrl zoom out', ctrlKey: true, deltaY: 120, expected: 'out' },
	{ name: 'ordinary main Meta zoom out', metaKey: true, deltaY: 120, expected: 'out' },
	{ name: 'Alt modified Ctrl wheel', ctrlKey: true, altKey: true, expected: null },
	{ name: 'vertical ruler Ctrl wheel', ctrlKey: true, ruler: true, expected: null },
	{ name: 'unmodified scrolling', expected: null },
] as const;

for (const options of cases) test(`timeline wheel preserves ${options.name}`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const add = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'addEventListener');
	const remove = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'removeEventListener');
	const listeners = new Set<EventListener>();
	Object.defineProperty(ReactTestElement.prototype, 'addEventListener', { configurable: true,
		value: (type: string, listener: EventListenerOrEventListenerObject | null) => { if (type === 'wheel' && typeof listener === 'function') listeners.add(listener); } });
	Object.defineProperty(ReactTestElement.prototype, 'removeEventListener', { configurable: true,
		value: (type: string, listener: EventListenerOrEventListenerObject | null) => { if (type === 'wheel' && typeof listener === 'function') listeners.delete(listener); } });
	const zooms: string[] = [];
	const controller = { actions: { timeline: { zoomIn: () => { zooms.push('in'); return 200; }, zoomOut: () => { zooms.push('out'); return 50; } } } };
	const snapshot = { timeline: { pixelsPerSecond: 100 }, preferences: { editing: { zoomPrecision: 1 } } };
	function Harness() {
		const editorRef = useRef<HTMLElement>(dom.container as unknown as HTMLElement);
		useTimelineNavigation({ controller, editorRef, workspaceRef: editorRef, project: { sampleRate: 48_000 }, snapshot,
			run: (operation: () => unknown) => operation() });
		return <><div className="audio-editor-timeline-scroll" /><div data-wheel-target className={'ruler' in options ? 'audio-editor-vertical-ruler' : ''} /></>;
	}
	try {
		await act(async () => root.render(<Harness />));
		const scroll = dom.one('.audio-editor-timeline-scroll');
		Object.defineProperties(scroll, { clientWidth: { value: 800 }, getBoundingClientRect: { value: () => ({ left: 0, top: 0, width: 800, height: 400 }) } });
		const event = Object.assign(new Event('wheel', { cancelable: true }), {
			ctrlKey: 'ctrlKey' in options, metaKey: 'metaKey' in options, altKey: 'altKey' in options,
			deltaY: 'deltaY' in options ? options.deltaY : -120, deltaMode: 0, clientX: 200,
		});
		Object.defineProperty(event, 'target', { value: dom.one('[data-wheel-target]') });
		if ('claimed' in options) event.preventDefault();
		assert.equal(listeners.size, 1);
		await act(async () => { for (const listener of listeners) listener(event); });
		assert.deepEqual(zooms, options.expected === null ? [] : [options.expected]);
		assert.equal(event.defaultPrevented, 'claimed' in options || options.expected !== null);
	} finally {
		await act(async () => root.unmount());
		assert.equal(listeners.size, 0);
		if (add) Object.defineProperty(ReactTestElement.prototype, 'addEventListener', add); else Reflect.deleteProperty(ReactTestElement.prototype, 'addEventListener');
		if (remove) Object.defineProperty(ReactTestElement.prototype, 'removeEventListener', remove); else Reflect.deleteProperty(ReactTestElement.prototype, 'removeEventListener');
		globals.IS_REACT_ACT_ENVIRONMENT = prior; dom.restore();
	}
});
