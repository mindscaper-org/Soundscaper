/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSettingPersistence } from '../src/common/editor/controller/preferences/setting-persistence.ts';

test('best-effort setting writes resolve with a controlled warning', async () => {
	const failure = new Error('quota');
	const warnings: unknown[] = [];
	const persistence = createSettingPersistence({
		write: async () => { throw failure; },
		onWarning: (error, key) => warnings.push({ error, key }),
	});
	assert.equal(await persistence.persist('workspace', { dock: 'right' }), null);
	assert.deepEqual(warnings, [{ error: failure, key: 'workspace' }]);
});

test('required setting writes preserve the storage rejection', async () => {
	const failure = new Error('closed');
	const persistence = createSettingPersistence({
		write: async () => { throw failure; },
	});
	await assert.rejects(
		persistence.persist('recording-routing', {}, { policy: 'required' }),
		(error) => error === failure,
	);
});

test('late setting failures after disposal do not publish warnings', async () => {
	const warnings: unknown[] = [];
	const persistence = createSettingPersistence({
		write: async () => { throw new Error('late'); },
		isInactive: () => true,
		onWarning: (error) => warnings.push(error),
	});
	assert.equal(await persistence.persist('meter', 1), null);
	assert.deepEqual(warnings, []);
});


test('atomic collection writes retain required failure reporting', async () => {
	const failure = new Error('Collection write unavailable');
	const warnings: unknown[] = [];
	const persistence = createSettingPersistence({ write: async () => { throw new Error('Plain write must not run'); },
		onWarning: (error, key) => warnings.push({ error, key }) });
	await assert.rejects(persistence.persist('delivery-presets', null, { policy: 'required', write: async () => { throw failure; } }),
		error => error === failure);
	assert.deepEqual(warnings, [{ error: failure, key: 'delivery-presets' }]);
});

test('Clear Data drains atomic collection writes before clearing and resetting', async () => {
	let release = () => {};
	const gate = new Promise<void>(resolve => { release = resolve; });
	const events: string[] = [];
	const persistence = createSettingPersistence({ write: async () => { throw new Error('Plain write must not run'); } });
	const writing = persistence.persist('delivery-presets', null, { policy: 'required', write: async () => {
		await gate; events.push('written');
	} });
	const clearing = persistence.clearStorage(async () => { events.push('cleared'); }, () => { events.push('reset'); }, async () => undefined);
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.deepEqual(events, []);
	await assert.rejects(persistence.persist('new-setting', 1), { name: 'InvalidStateError' });
	release(); await writing; await clearing;
	assert.deepEqual(events, ['written', 'cleared', 'reset']);
});
