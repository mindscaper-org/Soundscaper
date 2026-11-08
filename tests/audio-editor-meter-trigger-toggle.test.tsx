/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AudacityToolbarFlyoutButton } from '../src/common/editor/ui/toolbar/AudioEditorMeterControls.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('a meter trigger remains the toggle authority during its pointer press', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; React?: typeof React };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = globals.React;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	globals.React = React;
	const events = new EventTarget();
	document.addEventListener = events.addEventListener.bind(events);
	document.removeEventListener = events.removeEventListener.bind(events);
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<AudacityToolbarFlyoutButton icon="A" ariaLabel="Meter settings" flyoutClassName="test-meter"><p>Settings</p></AudacityToolbarFlyoutButton>));
		const trigger = dom.one('button');
		const click = () => reactProps(trigger).onClick?.({ nativeEvent: { detail: 1 } });
		await act(async () => { click(); });
		assert.equal(trigger.getAttribute('aria-expanded'), 'true');
		await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
		const press = new Event('pointerdown');
		Object.defineProperty(press, 'target', { value: trigger });
		await act(async () => { events.dispatchEvent(press); });
		await act(async () => { click(); });
		assert.equal(trigger.getAttribute('aria-expanded'), 'false');
		assert.equal(dom.container.querySelector('[role="dialog"]'), null);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		globals.React = priorReact;
		dom.restore();
	}
});
