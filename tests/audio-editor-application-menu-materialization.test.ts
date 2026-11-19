/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { materializeApplicationMenu } from '../src/common/editor/ui/application-menu-materialization.ts';

test('menu materialization resolves frozen leaves independently without mutating input', () => {
	const calls: string[] = [];
	const input = Object.freeze({
		id: 'edit',
		label: 'Edit',
		items: Object.freeze([
			Object.freeze({
				id: 'refused',
				label: 'Refused',
				disabled: false,
				resolve: () => {
					calls.push('refused');
					throw new Error('planner refusal');
				},
			}),
			Object.freeze({
				id: 'enabled',
				label: 'Enabled',
				disabled: true,
				resolve: () => {
					calls.push('enabled');
					return Object.freeze({ disabled: false });
				},
			}),
		]),
	});

	const materialized = materializeApplicationMenu(input);

	assert.deepEqual(calls, ['refused', 'enabled']);
	assert.notEqual(materialized, input);
	assert.deepEqual(materialized.items?.map(({ id, disabled }) => ({ id, disabled })), [
		{ id: 'refused', disabled: true },
		{ id: 'enabled', disabled: false },
	]);
	assert.ok(materialized.items?.every((item) => !Object.hasOwn(item, 'resolve')));
	assert.equal(typeof input.items[0].resolve, 'function');
	assert.equal(input.items[0].disabled, false);
});

test('live menu refresh retains deferred resolutions by id while updating ordinary items and callbacks', () => {
	let plans = 0;
	const resolve = () => { plans += 1; return { disabled: false }; };
	const before = { id: 'file', items: [{ id: 'group', items: [{ id: 'planned', label: 'Old', resolve }] },
		{ id: 'ordinary', disabled: true }] };
	const snapshot = materializeApplicationMenu(before);
	const action = () => undefined;
	const current = { id: 'file', items: [{ id: 'ordinary', disabled: false },
		{ id: 'group', items: [{ id: 'new', disabled: false, resolve }, { id: 'planned', label: 'Current', onClick: action, disabled: true,
			disabledReason: 'obsolete', resolve: () => { throw new Error('must retain the open-time plan'); } }] }] };
	const refreshed = materializeApplicationMenu(current, snapshot);
	assert.equal(plans, 1);
	assert.equal(refreshed.items[0]?.disabled, false);
	assert.equal(refreshed.items[1]?.items?.[0]?.disabled, true, 'new deferred commands wait for explicit planning');
	const planned = refreshed.items[1]?.items?.[1];
	assert.equal(planned?.disabled, false);
	assert.equal(planned?.label, 'Current');
	assert.equal(planned?.onClick, action);
	assert.equal(Object.hasOwn(planned!, 'disabledReason'), false);
});
