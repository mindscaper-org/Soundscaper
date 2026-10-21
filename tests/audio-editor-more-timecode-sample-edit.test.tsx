/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TimeCode } from '@soundscaper/design-system/TimeCode';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const rate of [44_100, 48_000, 96_000]) test(`sample digit editing replaces the requested integer at ${rate} Hz`, async () => {
	const dom = installReactTestDom();
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const keys = new Set<EventListenerOrEventListenerObject>();
	document.addEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => { if (kind === 'keydown' && listener) keys.add(listener); };
	document.removeEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => { if (kind === 'keydown' && listener) keys.delete(listener); };
	const root = createRoot(dom.container as unknown as Element);
	let value = 30;
	const render = () => root.render(<TimeCode value={value} format="samples" sampleRate={rate}
		onChange={next => { value = next; render(); }} />);
	try {
		await act(async () => { render(); });
		const digits = dom.container.querySelectorAll('.timecode-digit'); assert.ok(digits[0]);
		digits[0].focus();
		await act(async () => { reactProps(digits[0]!).onClick(); });
		for (const key of [...'1'.padStart(digits.length, '0'), 'Enter']) await act(async () => {
			const event = Object.assign(new Event('keydown', { cancelable: true }), { key });
			for (const listener of [...keys]) { if (typeof listener === 'function') listener(event); else listener.handleEvent(event); }
		});
		assert.equal(Math.round(value * rate), 1, 'sample entry must not retain a hidden fraction that rounds up at an edit boundary');
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
