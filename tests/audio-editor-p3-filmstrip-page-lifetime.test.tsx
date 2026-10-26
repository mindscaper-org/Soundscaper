/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { VideoFilmstripClip } from '../src/common/editor/ui/timeline/VideoFilmstrip.jsx';
import {
	bindProductVideoVisualPreviewRuntime,
	createProductVideoVisualPreviewRuntime,
	type ProductVideoTimelineFilmstripRequest,
} from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

async function fixture(t: TestContext) {
	const dom = installReactTestDom();
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const events = new EventTarget();
	const pageListeners = new Set<EventListenerOrEventListenerObject>();
	window.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null,
		options?: AddEventListenerOptions | boolean): void => {
		if (type === 'pagehide' && listener) pageListeners.add(listener);
		events.addEventListener(type, listener, options);
	};
	window.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null,
		options?: EventListenerOptions | boolean): void => {
		if (type === 'pagehide' && listener) pageListeners.delete(listener);
		events.removeEventListener(type, listener, options);
	};
	const requests: ProductVideoTimelineFilmstripRequest[] = [];
	let release!: () => void;
	const held = new Promise<void>((resolve) => { release = resolve; });
	let retiredReads = 0;
	const runtime = createProductVideoVisualPreviewRuntime(
		async () => null, undefined,
		async (request) => {
			requests.push(request);
			await held;
			if (request.signal?.aborted) throw request.signal.reason;
			retiredReads += 1;
			return [];
		},
	);
	const createController = (url = 'blob:outgoing-thumbnail') => {
		const value = { actions: { video: { getClipVisualData: () => ({
			available: true, thumbnails: [{ url, sourceTimeSeconds: 0 }],
		}) } } };
		bindProductVideoVisualPreviewRuntime(value, runtime);
		return value;
	};
	let controller = createController();
	const clip = {
		kind: 'video', id: 'video-clip', sourceId: 'video-source', title: 'Video',
		timelineStartFrame: 0, durationFrames: 48_000, sourceStartFrame: 0,
		sourceDurationFrames: 48_000,
	};
	let project = { id: 'project', clips: [clip] };
	let root = createRoot(dom.container as unknown as Element);
	let mounted = true;
	const unmount = async (): Promise<void> => {
		if (!mounted) return;
		mounted = false;
		await act(async () => root.unmount());
	};
	t.after(async () => {
		await unmount();
		release();
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	});
	const render = async (): Promise<void> => {
		await act(async () => root.render(<VideoFilmstripClip
			controller={controller} project={project} clip={clip}
			source={{ kind: 'video', id: 'video-source', frameRate: 24,
				frameCount: 48_000, sampleFrameCount: 48_000, sampleRate: 48_000,
				width: 96, height: 54 }}
			overscanStartFrame={0} overscanEndFrame={48_000}
			pixelsPerSecond={100} sampleRate={48_000} selected={false}
			dragging={false} invalidOverlap={false} hidden={false} blocked={false}
			copy={{ videoClip: 'Video clip', clipName: 'Clip name' }}
			onOpenMenu={() => undefined} onRename={() => undefined}
			renameRequestId={undefined} onRenameFinished={() => undefined}
		/>));
	};
	await render();
	assert.equal(requests.length, 1);
	assert.ok(requests[0]?.signal, 'the mounted filmstrip supplies its operation signal');
	return {
		requests, pageListeners, unmount,
		pageHide: (persisted = false) => events.dispatchEvent(Object.assign(new Event('pagehide'), { persisted })),
		async replace() { project = { ...project }; await render(); },
		rebind: () => bindProductVideoVisualPreviewRuntime(controller, runtime),
		async remount(freshController = false) {
			await unmount();
			if (freshController) controller = createController('blob:incoming-thumbnail');
			root = createRoot(dom.container as unknown as Element);
			mounted = true;
			await render();
		},
		async settle() { await act(async () => { release(); await held; }); },
		get retiredReads() { return retiredReads; },
	};
}

test('page navigation retires a pending timeline thumbnail before it reads an outgoing URL', async (t) => {
	const f = await fixture(t);
	assert.equal(f.requests[0]?.signal?.aborted, false);
	f.pageHide();
	assert.equal(f.requests[0]?.signal?.aborted, true);
	await f.settle();
	assert.equal(f.retiredReads, 0);
});

test('ordinary rerender retires only the replaced thumbnail request and removes its page listener', async (t) => {
	const f = await fixture(t);
	await f.replace();
	assert.equal(f.requests.length, 2);
	assert.equal(f.requests[0]?.signal?.aborted, true);
	assert.equal(f.requests[1]?.signal?.aborted, false);
	assert.equal(f.pageListeners.size, 1);
	f.pageHide();
	assert.equal(f.requests[1]?.signal?.aborted, true);
	await f.settle();
	assert.equal(f.retiredReads, 0);
});

test('a late rerender cannot revive a thumbnail request from a retired page', async (t) => {
	const f = await fixture(t);
	f.pageHide();
	await f.replace();
	assert.equal(f.requests.length, 1, 'the outgoing owner cannot schedule another URL read after pagehide');
	await f.settle();
	assert.equal(f.retiredReads, 0);
});

test('a late effect retains its originating document when the window document has changed', async (t) => {
	const f = await fixture(t);
	const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
	assert.ok(original);
	Object.defineProperty(globalThis, 'document', { configurable: true, value: {} });
	try {
		await f.replace();
		assert.equal(f.requests.length, 1, 'a new document must not receive the outgoing thumbnail URL');
		await f.settle();
		assert.equal(f.retiredReads, 0);
	} finally {
		Object.defineProperty(globalThis, 'document', original);
	}
});

test('a late remount cannot give an outgoing controller ownership of the incoming document', async (t) => {
	const f = await fixture(t);
	f.pageHide();
	await f.unmount();
	const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
	assert.ok(original);
	Object.defineProperty(globalThis, 'document', { configurable: true, value: {} });
	try {
		f.rebind();
		await f.remount();
		assert.equal(f.requests.length, 1, 'remounting the outgoing controller cannot admit its old URL');
		await f.remount(true);
		assert.equal(f.requests.length, 2, 'a fresh controller bound to the incoming document may decode its own URL');
		assert.equal(f.requests[1]?.signal?.aborted, false);
		assert.equal(f.requests[1]?.frames[0]?.sourceUrl, 'blob:incoming-thumbnail');
	} finally {
		Object.defineProperty(globalThis, 'document', original);
	}
});

test('a page retained in the back-forward cache keeps its pending request until a later navigation', async (t) => {
	const f = await fixture(t);
	f.pageHide(true);
	assert.equal(f.requests[0]?.signal?.aborted, false);
	assert.equal(f.pageListeners.size, 1);
	await f.settle();
	assert.equal(f.retiredReads, 1);
	f.pageHide(false);
	assert.equal(f.requests[0]?.signal?.aborted, true);
});

test('unmount releases the pending thumbnail and navigation listener', async (t) => {
	const f = await fixture(t);
	await f.unmount();
	assert.equal(f.requests[0]?.signal?.aborted, true);
	assert.equal(f.pageListeners.size, 0);
	await f.settle();
	assert.equal(f.retiredReads, 0);
});
