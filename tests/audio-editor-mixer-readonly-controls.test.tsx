/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MixerChannel } from '../vendor/audacity-design-system/components/src/MixerChannel/MixerChannel.tsx';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('a read-only mixer strip disables its mutations while retaining effect inspection', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<MixerChannel {...{ disabled: true }} trackName="Voice" effectSlotCount={2}
			effects={[{ name: 'Reverb', enabled: true, onClick() {}, onToggle() {}, onRemoveEffect() {} }]} />));
		assert.equal(dom.one('.mixer-fader').getAttribute('aria-disabled'), 'true');
		assert.equal(dom.one('.knob').hasAttribute('disabled'), true);
		const mutations = dom.container.querySelectorAll('.mixer-channel__toggle-btn, .mixer-effect__power, .mixer-effect__dropdown');
		assert.equal(mutations.length, 5);
		for (const button of mutations) {
			assert.equal(button.hasAttribute('disabled'), true, `${button.getAttribute('class')} cannot mutate this project`);
		}
		assert.equal(dom.one('.mixer-effect__name').hasAttribute('disabled'), false, 'read-only effects remain inspectable');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = prior;
		dom.restore();
	}
});
