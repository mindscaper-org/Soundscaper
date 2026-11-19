/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { menuTooltipPosition } from '../src/common/editor/ui/menu-tooltip-position.ts';

const anchor = { left: 200, right: 420, top: 100, bottom: 124 };
test('menu explanations prefer the right and flip to the left when that side is full', () => {
	assert.deepEqual(menuTooltipPosition(anchor, { width: 300, height: 120 }, { width: 1024, height: 768 }),
		{ left: 428, top: 100, side: 'right' });
	assert.deepEqual(menuTooltipPosition({ ...anchor, left: 700, right: 920 }, { width: 300, height: 120 }, { width: 1024, height: 768 }),
		{ left: 392, top: 100, side: 'left' });
});

test('small viewports and tall rich content stay within the viewport margins', () => {
	assert.deepEqual(menuTooltipPosition(anchor, { width: 300, height: 120 }, { width: 390, height: 180 }),
		{ left: 8, top: 52, side: 'left' });
	assert.deepEqual(menuTooltipPosition(anchor, { width: 300, height: 500 }, { width: 390, height: 180 }),
		{ left: 8, top: 8, side: 'left' });
});
