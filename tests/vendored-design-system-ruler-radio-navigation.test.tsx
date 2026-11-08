/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RulerFlyout } from '../vendor/audacity-design-system/components/src/RulerFlyout/RulerFlyout.tsx';
import { rulerFlyoutGroupItems } from '../vendor/audacity-design-system/components/src/utils/ruler-focus-items.ts';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

test('ruler groups retain checked radio entry and navigate only visible choices', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	// Supply the browser's compound query before the flyout's opening timer.
	const query = ReactTestElement.prototype.querySelector;
	ReactTestElement.prototype.querySelector = function (this: ReactTestElement, selector: string): ReactTestElement | null {
		return selector === '[role="radio"][aria-checked="true"]'
			? this.querySelectorAll('[role="radio"]').find(radio => radio.getAttribute('aria-checked') === 'true') ?? null
			: query.call(this, selector);
	};
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<RulerFlyout isOpen x={8} y={8} mode="waveform"
			rulerFormat="linear-db" onClose={() => undefined} />));
		await act(async () => { await new Promise<void>(resolve => { setTimeout(resolve, 1); }); });
		const flyout = dom.one('.ruler-flyout');
		const zoom = dom.one('[aria-label="Zoom in"]');
		const checked = dom.one('[aria-label="Linear (dB)"]');
		const next = dom.one('[aria-label="dB (logarithmic)"]');
		assert.strictEqual(document.activeElement, zoom);
		const key = async (target: ReactTestElement, value: string): Promise<void> => {
			await act(async () => reactProps(flyout).onKeyDown({ target, key: value,
				preventDefault() {}, stopPropagation() {} }));
		};
		await key(zoom, 'Tab');
		assert.strictEqual(document.activeElement, checked);
		await key(checked, 'ArrowRight');
		assert.strictEqual(document.activeElement, next);
		assert.ok(flyout.querySelectorAll('.radio__input').every(input => input.getAttribute('tabindex') === '-1'));
		await key(next, 'ArrowLeft');
		assert.strictEqual(document.activeElement, checked);
		await key(checked, 'Tab');
		assert.strictEqual(document.activeElement, dom.one('[role="checkbox"]'));
	} finally {
		await act(async () => root.unmount());
		ReactTestElement.prototype.querySelector = query;
		globals.IS_REACT_ACT_ENVIRONMENT = prior;
		dom.restore();
	}
});

test('ruler focus candidates retain native controls and checked choices while skipping unavailable inputs', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<div data-native-group>
			<button data-choice="button">Zoom</button><button disabled>Unavailable</button>
			<input data-choice="text" defaultValue="1000" /><input hidden readOnly value="" />
			<input aria-hidden="true" readOnly value="" /><input disabled readOnly value="" />
			<div role="radio" aria-checked="true" data-choice="checked" />
			<div role="radio" aria-checked="false" data-choice="unselected" />
			<div role="radio" aria-disabled="true" /><div role="checkbox" aria-hidden="true" />
		</div>));
		const choices = rulerFlyoutGroupItems(dom.one('[data-native-group]') as unknown as ParentNode);
		assert.deepEqual(choices.map(choice => choice.getAttribute('data-choice')), ['button', 'text', 'checked', 'unselected']);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = prior;
		dom.restore();
	}
});
