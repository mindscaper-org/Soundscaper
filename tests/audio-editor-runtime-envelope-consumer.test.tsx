/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { EnvelopeInteractionLayer, type EnvelopePoint } from '../vendor/audacity-design-system/components/src/EnvelopeInteractionLayer/EnvelopeInteractionLayer.tsx';
import { projectTimelineEnvelopeDesignPoints } from '../src/common/editor/ui/timeline/envelope-design-projection.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

void test('the production envelope editor copies frozen display points during drag and Escape', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const document = dom.container.ownerDocument as unknown as Document;
	const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
	document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (!listener) return;
		const entries = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
		entries.add(listener); listeners.set(type, entries);
	};
	document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (listener) listeners.get(type)?.delete(listener); };
	const root = createRoot(dom.container as unknown as Element);
	const original = projectTimelineEnvelopeDesignPoints({}, Object.freeze([Object.freeze({ frame: 500, value: 1 })]), 1_000, { startFrame: 0, endFrame: 1_000 });
	const updates: EnvelopePoint[][] = [];
	const publish = (points: EnvelopePoint[]) => { updates.push(points); };
	const dispatch = (type: string, event: Event) => {
		for (const listener of listeners.get(type) ?? []) {
			if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
		}
	};
	try {
		assert.ok(Object.isFrozen(original) && Object.isFrozen(original[0]));
		await act(async () => root.render(<EnvelopeInteractionLayer envelopePoints={original as EnvelopePoint[]}
			onEnvelopePointsChange={publish} enabled width={100} height={100} duration={1} />));
		const surface = dom.one('div');
		await act(async () => reactProps(surface).onMouseDown?.({ button: 0, clientX: 50,
			clientY: 97 * (1 - (5 / 6) ** 3), stopPropagation() {} }));
		await act(async () => dispatch('mousemove', { clientX: 65, clientY: 10 } as MouseEvent));
		assert.equal(updates.length, 1); assert.notEqual(updates[0], original);
		assert.notEqual(updates[0]?.[0], original[0], 'point dragging replaces the edited point');
		assert.deepEqual(original, [{ time: 0.5, db: 0 }]);
		await act(async () => dispatch('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} } as unknown as KeyboardEvent));
		assert.equal(updates.length, 2); assert.notEqual(updates[1], original);
		assert.deepEqual(updates[1], original, 'Escape publishes its own snapshot without mutating retained display points');
	} finally {
		await act(async () => root.unmount()); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		assert.equal(listeners.get('mousemove')?.size ?? 0, 0); assert.equal(listeners.get('keydown')?.size ?? 0, 0);
	}
});
