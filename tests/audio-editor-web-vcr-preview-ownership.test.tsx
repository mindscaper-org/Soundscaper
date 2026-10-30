/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import WebVcrPreview from '../src/common/editor/ui/workspace/WebVcrPreview.tsx';
import type { WebVcrKeyInput, WebVcrPointerInput, WebVcrUiSnapshot } from '../src/common/editor/ui/web-vcr-ui-model.ts';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

const snapshot: WebVcrUiSnapshot = {
	capability: { status: 'available', reason: null }, phase: 'ready', modeActive: true,
	navigation: { url: 'https://example.test', canGoBack: false, canGoForward: false, loading: false, generation: 1 },
	resolution: '1080p', availableResolutions: ['1080p'], autoCrop: true, aspect: 'free', crop: { x: 0, y: 0, width: 1, height: 1 }, monitorMuted: false, autoStop: false, surface: { width: 640, height: 360 }, output: null, intrinsic: null, target: null, lowerResolutionWarning: false, error: null, previewStream: {},
};

for (const leave of ['Escape', 'Tab', 'blur', 'disable', 'navigation', 'unmount']) test(`Web VCR releases forwarded keys on ${leave}`, async () => {
	const dom = installReactTestDom();
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const keys: WebVcrKeyInput[] = [];
	let releasedFocus = 0;
	const render = (disabled = false, next = snapshot) => <WebVcrPreview copy={{}} snapshot={next} disabled={disabled} onCrop={() => undefined} onPointerInput={() => undefined} onKeyInput={(input) => keys.push(input)} onReleaseFocus={() => releasedFocus++} />;
	const event = (key: string, code: string) => ({ key, code, repeat: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault() {}, stopPropagation() {} });
	try {
		await act(async () => root.render(render()));
		const surface = dom.one('[role="application"]');
		await act(async () => reactProps(surface).onKeyDown?.(event('ArrowLeft', 'ArrowLeft')));
		if (leave === 'Escape' || leave === 'Tab') await act(async () => reactProps(surface).onKeyDown?.(event(leave, leave)));
		else if (leave === 'blur') await act(async () => reactProps(surface).onBlur?.({}));
		else if (leave === 'disable') await act(async () => root.render(render(true)));
		else if (leave === 'navigation') await act(async () => root.render(render(false, { ...snapshot, navigation: { ...snapshot.navigation, generation: 2 } })));
		else await act(async () => root.unmount());
		assert.deepEqual(keys.map(({ action, code }) => [action, code]), [['down', 'ArrowLeft'], ['up', 'ArrowLeft']]);
		assert.equal(releasedFocus, leave === 'Escape' ? 1 : 0);
		if (leave !== 'unmount') {
			await act(async () => reactProps(surface).onKeyUp?.(event('ArrowLeft', 'ArrowLeft')));
			assert.equal(keys.length, 2, 'late physical release cannot duplicate the cleanup release');
		}
	} finally { if (leave !== 'unmount') await act(async () => root.unmount()); dom.restore(); }
});

test('remote wheel forwarding owns a non-passive listener and suppresses local scrolling', async () => {
	const dom = installReactTestDom();
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	const prior = ReactTestElement.prototype.addEventListener;
	let wheel: ((event: unknown) => void) | undefined;
	let passive: unknown;
	Object.defineProperty(ReactTestElement.prototype, 'addEventListener', { configurable: true, value: function (this: ReactTestElement, type: string, listener: (event: unknown) => void, options?: { passive?: boolean }) {
		if (type === 'wheel' && this.getAttribute('role') === 'application') { wheel = listener; passive = options?.passive; }
	} });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const pointers: WebVcrPointerInput[] = [];
	try {
		await act(async () => root.render(<WebVcrPreview copy={{}} snapshot={snapshot} disabled={false} onCrop={() => undefined} onPointerInput={(input) => pointers.push(input)} onKeyInput={() => undefined} onReleaseFocus={() => undefined} />));
		assert.equal(passive, false);
		let prevented = false;
		wheel?.({ clientX: 0, clientY: 0, deltaX: 0, deltaY: 11, preventDefault() { prevented = true; } });
		assert.equal(prevented, true);
		assert.equal(pointers[0]?.action, 'wheel');
		assert.equal(pointers[0]?.deltaY, 11);
	} finally { await act(async () => root.unmount()); Object.defineProperty(ReactTestElement.prototype, 'addEventListener', { configurable: true, value: prior }); dom.restore(); }
});
