/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AudacityEffectHeader from '../src/common/editor/ui/inspector/AudacityEffectHeader.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

void test('preset accessible names include the visible choice after selection changes', async () => {
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = environment.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	try {
		for (const presetName of ['Default preset', 'Speech cleanup']) {
			await act(async () => root.render(<AudacityEffectHeader copy={ENGLISH_COPY}
				automationEnabled={false} presetName={presetName} presets={['Default preset', 'Speech cleanup']} />));
			const trigger = dom.one('.dropdown__trigger');
			assert.equal(trigger.querySelector('.dropdown__text')?.textContent, presetName);
			assert.equal(trigger.getAttribute('aria-label'), `${ENGLISH_COPY.effectPreset}: ${presetName}`);
		}
	} finally {
		await act(async () => root.unmount());
		environment.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
