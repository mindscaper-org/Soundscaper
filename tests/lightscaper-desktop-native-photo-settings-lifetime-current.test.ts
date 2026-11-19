/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { LightscaperNativePhotoSettingsCurrentV1 as Settings } from '../desktop/lightscaper-native-photo-settings-current-v1.ts';
import { nativePhotoSettingsFixtureCurrentV1 as fixture, observeNativePhotoSettingsSqlCurrentV1 as observe,
	exactNativePhotoSettingsFailureCurrentV1 as exactFailure } from './helpers/lightscaper-native-photo-settings-integration-fixture-current.ts';

const METHODS = ['get', 'readEntry', 'put', 'delete', 'putIfAbsent', 'replaceIfCurrent', 'replaceIfCurrentAndPutIfAbsent', 'deleteIfCurrent'] as const;

test('Lightscaper native settings exposes a stable frozen own eight-method capability and detached results', async () => {
	await fixture(async f => {
		const descriptor = Object.getOwnPropertyDescriptor(f.owner, 'settingsRepository');
		assert.ok(descriptor && Object.hasOwn(descriptor, 'value')); assert.equal(descriptor.value, f.values);
		assert.equal(f.owner.settingsRepository, f.values); assert.equal(Object.isFrozen(f.values), true);
		assert.deepEqual(Object.keys(f.values).sort(), [...METHODS].sort());
		for (const name of METHODS) {
			const method = Object.getOwnPropertyDescriptor(f.values, name);
			assert.ok(method && Object.hasOwn(method, 'value')); assert.equal(typeof method.value, 'function');
		}
		const { put, get, readEntry } = f.values, original = { nested: { value: 1 } };
		const written = put('detached', original); original.nested.value = 9;
		assert.deepEqual(await written, { nested: { value: 1 } });
		const first = await get('detached') as { nested: { value: number } }; first.nested.value = 12;
		assert.deepEqual(await readEntry('detached'), { present: true, value: { nested: { value: 1 } } });
		assert.deepEqual(await readEntry('absent'), { present: false });
	});
});

test('Lightscaper accepted queue captures every expected/replacement before waiting and drains in request order on Close', async () => {
	await fixture(async f => {
		const initial = { revision: 1 }, expected = { revision: 1 }, replacement = { revision: 2 }, removed = { revision: 2 };
		const first = f.values.put('queue', initial), replace = f.values.replaceIfCurrent('queue', expected, replacement);
		const read = f.values.get('queue'), remove = f.values.deleteIfCurrent('queue', removed);
		initial.revision = 70; expected.revision = 71; replacement.revision = 72; removed.revision = 73;
		const closing = f.owner.close(); assert.equal(f.owner.close(), closing);
		assert.deepEqual(await first, { revision: 1 }); assert.equal(await replace, true);
		assert.deepEqual(await read, { revision: 2 }); assert.equal(await remove, true); await closing;
		const reopened = await Settings.open({ appDataPath: f.appDataPath });
		try { assert.deepEqual(await reopened.settingsRepository.readEntry('queue'), { present: false }); }
		finally { await reopened.close(); }
	});
});

test('Lightscaper actual Blob encoding cannot let a later scalar put overtake the accepted request', async () => {
	await fixture(async f => {
		const blob = new Blob([Uint8Array.of(9, 8, 7)], { type: 'application/x-lightscaper-settings' });
		const first = f.values.put('ordering', blob), last = f.values.put('ordering', { last: true }), read = f.values.get('ordering');
		const closing = f.owner.close();
		const detached = await first; assert.ok(detached instanceof Blob); assert.deepEqual(new Uint8Array(await detached.arrayBuffer()), Uint8Array.of(9, 8, 7));
		assert.deepEqual(await last, { last: true }); assert.deepEqual(await read, { last: true }); await closing;
	});
});

test('Lightscaper native settings keys preserve empty, lone-surrogate and astral UTF16 identities without aliasing', async () => {
	await fixture(async f => {
		const keys = ['', '\ud800', '\udc00', '\ud800\udc00', '\ufffd'];
		await Promise.all(keys.map((key, index) => f.values.putIfAbsent(key, { index })));
		for (let index = 0; index < keys.length; index++) assert.deepEqual(await f.values.get(keys[index]!), { index });
		assert.equal(f.control.prepare('SELECT COUNT(*) AS count FROM native_photo_settings').get()?.count, keys.length);
		await f.owner.close(); const reopened = await Settings.open({ appDataPath: f.appDataPath });
		try { for (let index = 0; index < keys.length; index++) assert.deepEqual(await reopened.settingsRepository.get(keys[index]!), { index }); }
		finally { await reopened.close(); }
	});
});

test('Lightscaper registers actual accepted work before a legal clone getter synchronously requests Close', async () => {
	await fixture(async f => {
		let closing: Promise<void> | undefined, getterCalls = 0, closedBeforeCommit = false, committed = false;
		const value = Object.defineProperty({}, 'captured', { enumerable: true, get() {
			getterCalls++; closing = f.owner.close(); void closing.then(() => { if (!committed) closedBeforeCommit = true; }); return 42;
		} });
		await observe(f.databasePath, (_database, sql) => { if (sql === 'COMMIT') committed = true; }, async () => {
			const work = f.values.put('reentrant', value);
			assert.equal(getterCalls, 1); assert.ok(closing); assert.equal(f.owner.close(), closing);
			assert.deepEqual(await work, { captured: 42 }); await closing;
		});
		assert.equal(committed, true); assert.equal(closedBeforeCommit, false);
		const reopened = await Settings.open({ appDataPath: f.appDataPath });
		try { assert.deepEqual(await reopened.settingsRepository.get('reentrant'), { captured: 42 }); }
		finally { await reopened.close(); }
	});
});

test('Lightscaper Close fences all eight borrowed calls before reflecting keys, expected values or payloads', async () => {
	await fixture(async f => {
		const closing = f.owner.close(); let traps = 0;
		const borrowed = new Proxy({}, { ownKeys() { traps++; throw Error('Closed capture'); }, get() { traps++; throw Error('Closed get'); },
			getPrototypeOf() { traps++; throw Error('Closed prototype'); } });
		const calls: ReadonlyArray<readonly [typeof METHODS[number], readonly unknown[]]> = [
			['get', [borrowed]], ['readEntry', [borrowed]], ['put', ['x', borrowed]], ['delete', [borrowed]],
			['putIfAbsent', ['x', borrowed]], ['replaceIfCurrent', ['x', borrowed, borrowed]],
			['replaceIfCurrentAndPutIfAbsent', ['x', borrowed, borrowed, 'intent', borrowed]], ['deleteIfCurrent', ['x', borrowed]],
		];
		for (const [name, args] of calls) await assert.rejects(Reflect.apply(f.values[name], f.values, args) as Promise<unknown>);
		await closing; assert.equal(traps, 0);
	});
});

test('Lightscaper opaque clone-getter failure leaves no row and does not poison drain-only Close', async () => {
	await fixture(async f => {
		let traps = 0;
		const failure = new Proxy({}, { get() { traps++; throw Error('Opaque get'); }, getPrototypeOf() { traps++; throw Error('Opaque prototype'); } });
		const value = Object.defineProperty({}, 'bad', { enumerable: true, get() { throw failure; } });
		const refused = exactFailure(f.values.put('bad', value), failure), admitted = f.values.put('good', { durable: true });
		const closing = f.owner.close(); await refused; await admitted; await closing; assert.equal(traps, 0);
		const reopened = await Settings.open({ appDataPath: f.appDataPath });
		try { assert.deepEqual(await reopened.settingsRepository.readEntry('bad'), { present: false }); assert.deepEqual(await reopened.settingsRepository.get('good'), { durable: true }); }
		finally { await reopened.close(); }
	});
});

test('Lightscaper same catalog keys remain isolated across the anchor and distinct immutable selected labels', async () => {
	await fixture(async f => {
		const first = await Settings.open({ appDataPath: f.appDataPath, scope: 'selected:restored.a' });
		const second = await Settings.open({ appDataPath: f.appDataPath, scope: 'selected:restored.b' });
		const key = 'photo-library:develop-presets:v1:catalog';
		try {
			await f.values.put(key, { anchor: 1 }); await first.settingsRepository.put(key, { generation: 'a' });
			await second.settingsRepository.put(key, { generation: 'b' });
			assert.deepEqual(await f.values.get(key), { anchor: 1 }); assert.deepEqual(await first.settingsRepository.get(key), { generation: 'a' });
			assert.deepEqual(await second.settingsRepository.get(key), { generation: 'b' });
			assert.equal(f.control.prepare('SELECT COUNT(*) AS count FROM native_photo_settings').get()?.count, 3);
		} finally { await Promise.all([first.close(), second.close()]); }
	});
});
