/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { canonicalStripRefKey } from '../src/common/editor/parameter-address.ts';
import { enablePlaybackMeterDemand, readPlaybackMeterDemand } from '../src/common/editor/engine/playback-meter-demand.ts';
import { observePlaybackMeterVisibility } from '../src/common/editor/ui/usePlaybackMeterVisibility.ts';
import { MixerTelemetryMeters } from '../src/common/editor/ui/workspace/MixerTelemetryMeters.tsx';
import { installReactTestDom } from './helpers/react-test-dom.ts';

const strip = { kind: 'track', id: 'track' } as const;
const key = canonicalStripRefKey(strip);

test('one observer shares independent timeline/mixer leases and releases hidden or removed meters', () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver');
	Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, value: FakeObserver });
	const owner = {};
	enablePlaybackMeterDemand(owner);
	const first = {} as Element, second = {} as Element;
	const releaseFirst = observePlaybackMeterVisibility(owner, strip, first);
	const releaseSecond = observePlaybackMeterVisibility(owner, strip, second);
	try {
		const observer = FakeObserver.latest!;
		assert.equal(observer.elements.size, 2);
		assert.equal(readPlaybackMeterDemand(owner, null)?.has(key), false, 'registered observers opt in even before their first visible lease');
		observer.notify(first, false); observer.notify(second, false);
		assert.deepEqual(readPlaybackMeterDemand(owner, null), new Set([canonicalStripRefKey({ kind: 'master' })]),
			'first-render offscreen strips never leave full metering enabled');
		observer.notify(first, true); observer.notify(first, true); observer.notify(second, true);
		assert.equal(readPlaybackMeterDemand(owner, null)?.has(key), true);
		observer.notify(first, false);
		assert.equal(readPlaybackMeterDemand(owner, null)?.has(key), true, 'the mixer can retain a strip scrolled out of the timeline');
		releaseSecond(); releaseSecond();
		assert.equal(readPlaybackMeterDemand(owner, null)?.has(key), false);
		assert.equal(observer.elements.size, 1);
		releaseFirst();
		assert.equal(observer.disconnected, true);
		observer.notify(first, true);
		assert.equal(readPlaybackMeterDemand(owner, null)?.has(key), false, 'retired callbacks cannot recreate a lease');
	} finally {
		releaseFirst(); releaseSecond();
		restore('IntersectionObserver', previous);
	}
});

test('mounted mixer meter visibility drives engine demand without changing the two meter bars', async () => {
	const dom = installReactTestDom();
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver');
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
	Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, value: FakeObserver });
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
	const engine = {};
	enablePlaybackMeterDemand(engine);
	const telemetry = {};
	const controller = { engine, getTelemetrySnapshot: () => telemetry, subscribeTelemetry: () => () => {} };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<MixerTelemetryMeters controller={controller} scope="track" targetId="track" />));
		const observer = FakeObserver.latest!;
		assert.equal(observer.elements.size, 1, 'only the first existing stereo bar is observed');
		const bar = observer.elements.values().next().value!;
		observer.notify(bar, true);
		assert.equal(readPlaybackMeterDemand(engine, null)?.has(key), true);
		observer.notify(bar, false);
		assert.equal(readPlaybackMeterDemand(engine, null)?.has(key), false);
		observer.notify(bar, true);
	} finally {
		await act(async () => root.unmount());
		assert.equal(readPlaybackMeterDemand(engine, null)?.has(key), false);
		restore('IntersectionObserver', previousObserver);
		restore('React', previousReact);
		restore('IS_REACT_ACT_ENVIRONMENT', previousAct);
		dom.restore();
	}
});

test('browsers without intersection observation retain mounted meter demand until cleanup', () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver');
	Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, value: undefined });
	const owner = {};
	enablePlaybackMeterDemand(owner);
	const release = observePlaybackMeterVisibility(owner, strip, {} as Element);
	try { assert.equal(readPlaybackMeterDemand(owner, null)?.has(key), true); }
	finally { release(); restore('IntersectionObserver', previous); }
	assert.equal(readPlaybackMeterDemand(owner, null)?.has(key), false);
});

test('a second observer on a visible target immediately holds its independent lease', () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver');
	Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, value: FakeObserver });
	const owner = {}, element = {} as Element;
	enablePlaybackMeterDemand(owner);
	const releaseFirst = observePlaybackMeterVisibility(owner, strip, element);
	let releaseSecond: (() => void) | undefined;
	try {
		const observer = FakeObserver.latest!;
		observer.notify(element, true);
		releaseSecond = observePlaybackMeterVisibility(owner, strip, element);
		releaseFirst();
		assert.equal(observer.elements.size, 1);
		assert.equal(readPlaybackMeterDemand(owner, null)?.has(key), true,
			'the second listener must retain demand without waiting for a geometry change');
		observer.notify(element, false);
		assert.equal(readPlaybackMeterDemand(owner, null)?.has(key), false);
	} finally {
		releaseFirst(); releaseSecond?.();
		restore('IntersectionObserver', previous);
	}
});

class FakeObserver {
	static latest: FakeObserver | null = null;
	readonly elements = new Set<Element>();
	disconnected = false;
	constructor(private readonly callback: IntersectionObserverCallback) { FakeObserver.latest = this; }
	observe(element: Element): void { this.elements.add(element); }
	unobserve(element: Element): void { this.elements.delete(element); }
	disconnect(): void { this.disconnected = true; this.elements.clear(); }
	notify(target: Element, visible: boolean): void {
		this.callback([{ target, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 } as IntersectionObserverEntry],
			this as unknown as IntersectionObserver);
	}
}

function restore(key: string, descriptor: PropertyDescriptor | undefined): void {
	if (descriptor) Object.defineProperty(globalThis, key, descriptor);
	else Reflect.deleteProperty(globalThis, key);
}
