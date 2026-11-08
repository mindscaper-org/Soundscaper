/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import EffectPicker from '../src/common/editor/ui/inspector/EffectPicker.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('the shipped flyout keeps an unavailable rack effect visible but cannot choose it', async () => {
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = environment.IS_REACT_ACT_ENVIRONMENT, previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	environment.IS_REACT_ACT_ENVIRONMENT = true; Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const calls: string[] = [];
	try {
		await act(async () => { root.render(<EffectPicker copy={ENGLISH_COPY} disabled={false} flyout
			effectTypes={['reverb', 'delay']} unavailableEffectTypes={['reverb']} onClose={() => undefined} onChoose={(type: string) => { calls.push(type); }} />); });
		const options = dom.container.ownerDocument.body.querySelectorAll('[role="menuitem"]');
		const [reverb, delay] = options;
		assert.ok(reverb); assert.ok(delay);
		assert.equal(reverb.hasAttribute('disabled'), true);
		assert.equal(reverb.getAttribute('title'), ENGLISH_COPY.effectUnsupported);
		assert.equal(delay.hasAttribute('disabled'), false);
		await act(async () => { reactProps(reverb).onClick(); await Promise.resolve(); });
		assert.deepEqual(calls, []);
	} finally {
		await act(async () => { root.unmount(); }); environment.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React'); dom.restore();
	}
});
