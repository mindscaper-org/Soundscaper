/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClipFadePresetItems } from '../src/common/editor/ui/timeline/ClipFadePresetItems.tsx';

void test('fade presets expose localized radio items, curve drawings and the existing handle shortcuts', () => {
	const render = (hasFade: boolean, shape: number | undefined, edge: 'in' | 'out' = 'in') => renderToStaticMarkup(
		<ClipFadePresetItems edge={edge} hasFade={hasFade} shape={shape} copy={{ fadeShapeLinear: 'Gerade' }} onSelect={() => {}} />,
	);
	const bare = render(false, 2);
	assert.equal((bare.match(/role="menuitemradio"/gu) ?? []).length, 5);
	assert.equal((bare.match(/<path /gu) ?? []).length, 5);
	assert.doesNotMatch(bare, /aria-checked="true"/u);
	assert.match(bare, /Gerade/u);
	for (const shortcut of [1, 2, 3, 4, 5]) assert.match(bare, new RegExp(`context-menu-item-shortcut">${shortcut}<`, 'u'));
	assert.equal((render(true, undefined).match(/aria-checked="true"/gu) ?? []).length, 1);
	assert.doesNotMatch(render(true, 2.345), /aria-checked="true"/u);
	assert.notEqual(render(true, 2, 'in'), render(true, 2, 'out'), 'each side draws its own direction');
});
