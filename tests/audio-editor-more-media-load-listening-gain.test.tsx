/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioEditorListeningGainContext, AudioEditorListeningPreview } from '../src/common/editor/ui/audio-editor-listening-preview.tsx';
import { installReactTestDom, ReactTestElement } from './helpers/react-test-dom.ts';

type MediaListener = EventListenerOrEventListenerObject;

function installMetadataEvents() {
	const listeners = new WeakMap<ReactTestElement, Set<MediaListener>>();
	const priorAdd = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'addEventListener');
	const priorRemove = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'removeEventListener');
	Object.defineProperty(ReactTestElement.prototype, 'addEventListener', { configurable: true,
		value(this: ReactTestElement, type: string, listener: MediaListener | null) {
			if (type !== 'loadedmetadata' || !listener) return;
			const entries = listeners.get(this) ?? new Set<MediaListener>();
			entries.add(listener); listeners.set(this, entries);
		} });
	Object.defineProperty(ReactTestElement.prototype, 'removeEventListener', { configurable: true,
		value(this: ReactTestElement, type: string, listener: MediaListener | null) {
			if (type === 'loadedmetadata' && listener) listeners.get(this)?.delete(listener);
		} });
	const current = (element: ReactTestElement) => [...(listeners.get(element) ?? [])];
	const fire = (element: ReactTestElement, captured = current(element)): void => {
		const event = new Event('loadedmetadata');
		for (const listener of captured) {
			if (typeof listener === 'function') listener.call(element as unknown as EventTarget, event);
			else listener.handleEvent(event);
		}
	};
	return { current, fire, restore() {
		if (priorAdd) Object.defineProperty(ReactTestElement.prototype, 'addEventListener', priorAdd);
		else Reflect.deleteProperty(ReactTestElement.prototype, 'addEventListener');
		if (priorRemove) Object.defineProperty(ReactTestElement.prototype, 'removeEventListener', priorRemove);
		else Reflect.deleteProperty(ReactTestElement.prototype, 'removeEventListener');
	} };
}

for (const requestedGain of [1, 0, .25]) test(`mounted speech media restores current requested gain ${String(requestedGain)} after native initialization`, async () => {
	const dom = installReactTestDom();
	const metadata = installMetadataEvents();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const render = async (gain: number): Promise<void> => {
		await act(async () => root.render(<AudioEditorListeningGainContext.Provider value={gain}>
			<AudioEditorListeningPreview controls src="blob:generated-speech" />
		</AudioEditorListeningGainContext.Provider>));
	};
	try {
		await render(1);
		const element = dom.one('audio');
		const player = element as unknown as HTMLAudioElement;
		assert.equal(player.volume, 1);
		await render(requestedGain);
		player.volume = requestedGain === 0 ? 1 : 0;
		metadata.fire(element);
		assert.equal(player.volume, requestedGain, 'metadata readiness reads the current gain instead of its creation-time value');
		player.volume = .4;
		metadata.fire(element);
		assert.equal(player.volume, .4, 'a later native control edit is not repeatedly overwritten');
	} finally {
		await act(async () => root.unmount());
		metadata.restore(); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
	}
});

test('replaced and unmounted speech media retire obsolete metadata callbacks', async () => {
	const dom = installReactTestDom();
	const metadata = installMetadataEvents();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const render = async (src: string, gain: number): Promise<void> => {
		await act(async () => root.render(<AudioEditorListeningGainContext.Provider value={gain}>
			<AudioEditorListeningPreview controls src={src} />
		</AudioEditorListeningGainContext.Provider>));
	};
	let unmounted = false;
	try {
		await render('blob:first-speech', 1);
		const element = dom.one('audio');
		const player = element as unknown as HTMLAudioElement;
		const obsolete = metadata.current(element);
		await render('blob:second-speech', 0);
		player.volume = .4;
		metadata.fire(element, obsolete);
		assert.equal(player.volume, .4, 'an old source callback cannot modify its replacement');
		player.volume = 1;
		metadata.fire(element);
		assert.equal(player.volume, 0);
		await render('blob:third-speech', .25);
		const retiring = metadata.current(element);
		await act(async () => root.unmount()); unmounted = true;
		player.volume = .6;
		metadata.fire(element, retiring);
		assert.equal(player.volume, .6, 'a queued callback is inert after unmount');
		assert.equal(metadata.current(element).length, retiring.length - 1, 'retirement removes its readiness listener while retaining React native event delegation');
	} finally {
		if (!unmounted) await act(async () => root.unmount());
		metadata.restore(); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
	}
});
