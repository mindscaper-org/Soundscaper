/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeCorridorKeyMenu } from '../src/common/editor/ui/corridorkey-menu.ts';

test('CorridorKey opens only through the existing Framescaper video-effects submenu', () => {
	let opened = false;
	const menus = [{ id: 'effect', items: [{ id: 'framescaper-video-effects', disabled: true, items: [{ id: 'other' }] }] }];
	const result = mergeCorridorKeyMenu(menus, { productId: 'framescaper', copy: {}, open() { opened = true; } });
	const group = result[0]!.items![0]!;
	assert.equal(group.disabled, false); assert.deepEqual(group.items!.map(({ id }) => id), ['other', 'corridorkey-2.0']);
	group.items![1]!.onClick!(); assert.equal(opened, true);
	assert.deepEqual(mergeCorridorKeyMenu(menus, { productId: 'soundscaper', copy: {}, open() {} }), menus);
	assert.deepEqual(mergeCorridorKeyMenu(menus, { productId: 'framescaper', copy: {} }), menus);
});
