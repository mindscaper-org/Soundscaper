/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { retainTooltipDescription } from '../vendor/audacity-design-system/components/src/utils/retain-tooltip-description.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('tooltip descriptions preserve accessible help owned by other features', () => {
	const dom = installReactTestDom();
	try {
		const target = dom.container as unknown as HTMLElement;
		target.setAttribute('aria-describedby', 'existing');
		const release = retainTooltipDescription(target, 'tooltip');
		assert.equal(target.getAttribute('aria-describedby'), 'existing tooltip');
		target.setAttribute('aria-describedby', 'existing tooltip validation');
		release();
		assert.equal(target.getAttribute('aria-describedby'), 'existing validation');
		release();
		assert.equal(target.getAttribute('aria-describedby'), 'existing validation');
		target.removeAttribute('aria-describedby');
		retainTooltipDescription(target, 'tooltip')();
		assert.equal(target.getAttribute('aria-describedby'), null);
	} finally { dom.restore(); }
});
