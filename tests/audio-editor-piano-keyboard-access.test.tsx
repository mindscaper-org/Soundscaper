/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { PianoKeyboard } from '../vendor/audacity-design-system/components/src/PianoRoll/PianoKeyboard.tsx';
import { AccessibilityProfileProvider } from '../vendor/audacity-design-system/components/src/contexts/AccessibilityProfileContext.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('piano preview keys expose names and one roving keyboard stop with semitone navigation', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(window, 'getComputedStyle', { configurable: true, value: () => ({ display: '', visibility: '' }) });
	const pitches: number[] = [];
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<AccessibilityProfileProvider initialProfileId="au4-tab-groups"><PianoKeyboard scrollY={1024} noteHeight={16} height={252}
			onKeyClick={pitch => { pitches.push(pitch); }} /></AccessibilityProfileProvider>));
		const key = dom.one('[aria-label="C4"]');
		assert.equal(key.tagName, 'BUTTON');
		const keys = dom.container.querySelectorAll('button');
		assert.equal(keys.filter(key => key.getAttribute('tabindex') === '0').length, 1);
		key.focus();
		const group = dom.one('[role="toolbar"]');
		await act(async () => { reactProps(group).onKeyDown?.({ target: key, key: 'ArrowUp', preventDefault() {}, stopPropagation() {} }); });
		assert.strictEqual(dom.container.ownerDocument.activeElement, dom.one('[aria-label="C#4"]'));
		await act(async () => { reactProps(dom.one('[aria-label="C#4"]')).onClick?.({ stopPropagation() {} }); });
		assert.deepEqual(pitches, [61]);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore();
	}
});
