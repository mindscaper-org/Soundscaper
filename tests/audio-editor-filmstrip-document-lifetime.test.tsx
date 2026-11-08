/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { VideoFilmstripClip } from '../src/common/editor/ui/timeline/VideoFilmstrip.jsx';
import { bindProductVideoVisualPreviewRuntime, createProductVideoVisualPreviewRuntime,
	type ProductVideoTimelineFilmstripRequest } from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { deferred } from './helpers/async-test-control.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

function installNativeEvents(target: Window) {
	const events = new EventTarget(), listeners = new Set<EventListenerOrEventListenerObject>();
	Object.defineProperties(target, {
		addEventListener: { value(type: string, callback: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean) {
			if (type === 'pagehide') listeners.add(callback); events.addEventListener(type, callback, options);
		} },
		removeEventListener: { value(type: string, callback: EventListenerOrEventListenerObject, options?: EventListenerOptions | boolean) {
			if (type === 'pagehide') listeners.delete(callback); events.removeEventListener(type, callback, options);
		} },
		dispatchEvent: { value: events.dispatchEvent.bind(events) },
	});
	return { events, listeners };
}

for (const retirement of ['pagehide', 'unmount', 'pagehide-rerender', 'pagehide-remount'] as const) test(`mounted filmstrip cancels its held batch on ${retirement} before another frame can load`, async () => {
	const held = deferred<void>(), batches: Promise<void>[] = [];
	const requests: ProductVideoTimelineFilmstripRequest[] = [];
	let laterFrameLoads = 0, finishedBatches = 0;
	const controller = { actions: { video: { getClipVisualData: () => null } } };
	bindProductVideoVisualPreviewRuntime(controller, createProductVideoVisualPreviewRuntime(
		async () => null, async () => null, async request => {
			const settled = deferred<void>(); batches.push(settled.promise);
			requests.push(request);
			try {
				await held.promise;
				request.signal?.throwIfAborted();
				laterFrameLoads += request.frames.length;
				return request.frames.map(frame => ({ key: frame.key, timelineSample: frame.timelineSample,
					width: 2, height: 2, pixels: new Uint8Array(16) }));
			} finally { finishedBatches++; settled.resolve(); }
		},
	));
	const dom = installReactTestDom(), { events, listeners } = installNativeEvents(window);
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }, priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React }); globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	let unmounted = false;
	let incoming: ReturnType<typeof installReactTestDom> | undefined;
	let incomingEvents: ReturnType<typeof installNativeEvents> | undefined;
	const render = (key = 'initial') => { root.render(<VideoFilmstripClip key={key} controller={controller} project={{ schemaVersion: 30, clips: [] }}
			clip={{ kind: 'image', id: 'clip', sourceId: 'source', title: 'Poster', timelineStartFrame: 0, durationFrames: 480_000 }}
			source={{ kind: 'image', id: 'source' }} overscanStartFrame={0} overscanEndFrame={480_000}
			pixelsPerSecond={100} sampleRate={48_000} selected={false} dragging={false} invalidOverlap={false}
			hidden={false} blocked={false} copy={{ videoClip: 'Video clip', clipName: 'Clip name' }}
			onOpenMenu={() => undefined} onRename={undefined} renameRequestId={undefined} onRenameFinished={undefined} />); };
	try {
		await act(async () => { render(); });
		assert.equal(requests.length, 1); assert.equal(requests[0]!.frames.length, 2);
		const signal = requests[0]!.signal; assert.ok(signal); assert.equal(signal.aborted, false);
		if (retirement !== 'unmount') {
			await act(async () => { events.dispatchEvent(new Event('pagehide')); });
			assert.equal(signal.aborted, true, 'native document retirement must cancel the still-mounted old batch');
			assert.ok(dom.find('[data-product-visual-thumbnail]'), 'pagehide is tested without React unmount');
			if (retirement === 'pagehide-rerender') {
				await act(async () => { render(); });
				assert.equal(requests.length, 1, 'a retired document must not admit a replacement batch after a mounted rerender');
			} else if (retirement === 'pagehide-remount') {
				const originalDocument = dom.container.ownerDocument;
				incoming = installReactTestDom(); incomingEvents = installNativeEvents(window);
				await act(async () => { render('replacement'); });
				assert.equal(dom.one('[data-clip-id="clip"]').ownerDocument === originalDocument, true,
					'the key-remounted host retains its actual old React root document');
				assert.equal(originalDocument === (globalThis.document as unknown), false,
					'the incoming global document is a distinct native owner');
				assert.equal(requests.length, 1, 'an old-root remount must not admit work into the incoming document');
				incoming.restore(); incoming = undefined;
			}
		} else { await act(async () => { root.unmount(); }); unmounted = true; assert.equal(signal.aborted, true); }
		const reason: unknown = signal.reason;
		await act(async () => { held.resolve(); await Promise.all(batches); });
		assert.equal(finishedBatches, 1); assert.equal(laterFrameLoads, 0);
		if (!unmounted) { await act(async () => { root.unmount(); }); unmounted = true; }
		assert.equal(listeners.size, 0, 'ordinary effect cleanup removes its document listener');
		assert.equal(incomingEvents?.listeners.size ?? 0, 0, 'no document listener survives an old-root remount');
		events.dispatchEvent(new Event('pagehide')); assert.equal(signal.reason, reason);
	} finally {
		try {
			try {
				incoming?.restore(); incoming = undefined;
				if (!unmounted) await act(async () => { root.unmount(); });
			} finally { held.resolve(); await Promise.all(batches); }
		} finally {
			dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
		}
	}
});
