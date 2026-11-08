/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@soundscaper/design-system/ThemeProvider';
import { OutputTrackRow } from '../src/common/editor/ui/timeline/OutputTrackRows.jsx';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

for (const scope of ['master', 'group', 'send'] as const) for (const release of ['mouseup', 'blur', 'lost primary'] as const) {
	test(`${scope} envelope publishes its last held level once after ${release}`, async context => {
		context.mock.timers.enable({ apis: ['setTimeout'] });
		const dom = installReactTestDom();
		const prior = new Map<string, PropertyDescriptor | undefined>();
		for (const [key, value] of Object.entries({ React, IS_REACT_ACT_ENVIRONMENT: true })) {
			prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
			Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
		}
		const canvas = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
		Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => null });
		type Listeners = Map<string, Map<EventListenerOrEventListenerObject, boolean>>;
		const documentListeners: Listeners = new Map(), windowListeners: Listeners = new Map();
		for (const [target, listeners] of [[dom.container.ownerDocument as unknown as Document, documentListeners], [window, windowListeners]] as const) {
			target.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
				if (!listener) return;
				const entries = listeners.get(type) ?? new Map();
				entries.set(listener, typeof options === 'boolean' ? options : options?.capture === true);
				listeners.set(type, entries);
			};
			target.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (listener) listeners.get(type)?.delete(listener); };
		}
		const publications: unknown[] = [];
		const telemetry = {};
		const controller = { getTelemetrySnapshot: () => telemetry, subscribeTelemetry: () => () => {}, actions: { mixer: {
			updateMaster: (changes: unknown) => publications.push(changes),
			updateBus: (_scope: string, _id: string, changes: unknown) => publications.push(changes),
		} } };
		const noop = () => undefined;
		const root = createRoot(dom.container as unknown as Element);
		const dispatch = async (type: string, properties: Readonly<Record<string, number>>, listeners = documentListeners) => {
			await act(async () => {
				const event = Object.assign(new Event(type), properties);
				for (const capture of [true, false]) for (const [listener, isCapture] of [...listeners.get(type) ?? []]) {
					if (isCapture !== capture) continue;
					if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
				}
				context.mock.timers.runAll();
			});
		};
		try {
			await act(async () => { root.render(<ThemeProvider><OutputTrackRow controller={controller}
				rowKey={`${scope}:bus`} scope={scope} bus={{ id: 'bus', name: 'Output', gain: 1, pan: 0, envelope: [], collapsed: false }}
				focused onFocus={noop} onMenu={noop} onFocusPanel={noop} onFocusLane={noop}
				onFocusPreviousLane={noop} onFocusNextPanel={noop} onNavigatePanel={noop} onNavigateLane={noop}
				panelWidth={200} verticalRulerWidth={0} viewportWidth={100} timelineWidth={100} scrollX={0}
				pixelsPerSecond={100} sampleRate={48_000} durationFrames={48_000} selection={null} rulerScale={null} mappedTicks={null}
				automationToolEnabled stripEnvelopeAvailable blocked={false} mobile={false}
				copy={{ master: 'Master', volumeEnvelope: 'Volume envelope' }} run={(operation: () => unknown) => operation()}
				onOpenEffects={noop} /></ThemeProvider>); });
			const envelope = dom.one('.audio-editor-output-envelope');
			const surface = envelope.querySelectorAll('div').find(node => node !== dom.one('.envelope-curve') && typeof reactProps(node).onMouseDown === 'function');
			assert.ok(surface);
			Object.defineProperty(surface, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 0, top: 0, width: 100, height: 114 }) });
			const y = 111 * (1 - (5 / 6) ** 3);
			await act(async () => {
				reactProps(envelope).onMouseDownCapture?.({ button: 0 });
				reactProps(surface).onMouseDown?.({ button: 0, clientX: 50, clientY: y, stopPropagation() {} });
			});
			await dispatch('mousemove', { button: 0, buttons: 1, clientX: 50, clientY: y + 12 });
			assert.equal(publications.length, 0, 'a held preview is not published');
			if (release === 'blur') await dispatch('blur', {}, windowListeners);
			else if (release === 'lost primary') await dispatch('mousemove', { button: 0, buttons: 0, clientX: 50, clientY: y - 25 });
			else await dispatch('mouseup', { button: 0, buttons: 0, clientX: 50, clientY: y + 12 });
			assert.equal(publications.length, 1, 'outside release completes the same single edit as an ordinary release');
			const committed = publications[0];
			assert.ok(committed && typeof committed === 'object' && 'envelope' in committed && Array.isArray(committed.envelope));
			const expectedGain = 10 ** ((-60 + 72 * Math.cbrt((111 - y - 12) / 111)) / 20);
			assert.equal(committed.envelope.length, 2);
			for (const point of committed.envelope) {
				assert.ok(point && typeof point === 'object' && 'value' in point && typeof point.value === 'number');
				assert.ok(Math.abs(point.value - expectedGain) < 1e-8, 'completion retains the last intended attenuation');
			}
			await dispatch('mousemove', { button: 0, buttons: 0, clientX: 50, clientY: y - 25 });
			await dispatch('mouseup', { button: 0, buttons: 0 });
			assert.equal(publications.length, 1, 'later hovering cannot publish another edit');
		} finally {
			await act(async () => { root.unmount(); context.mock.timers.runAll(); });
			if (canvas) Object.defineProperty(ReactTestElement.prototype, 'getContext', canvas); else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
			for (const [key, descriptor] of prior) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
			}
			dom.restore();
		}
	});
}
