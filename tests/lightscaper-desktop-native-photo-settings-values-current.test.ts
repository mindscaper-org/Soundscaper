/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { nativeSettingsFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-photo-settings-fixture-current.ts';

test('Lightscaper native settings distinguish physical absence, undefined and null across fresh owners', async context => {
	const f = await fixture(context), s = f.settings;
	assert.deepEqual(await s.readEntry('unset'), { present: false });
	assert.equal(await s.get('unset'), undefined);
	assert.equal(await s.put('present', undefined), undefined);
	assert.equal(await s.putIfAbsent('present', 'replacement'), false);
	await f.owner.close();
	const reopened = await f.open();
	assert.deepEqual(await reopened.settingsRepository.readEntry('present'), { present: true, value: undefined });
	assert.equal(await reopened.settingsRepository.put('present', null), null);
	assert.equal(await reopened.settingsRepository.putIfAbsent('present', 'replacement'), false);
	await reopened.close();
	const third = (await f.open()).settingsRepository;
	assert.deepEqual(await third.readEntry('present'), { present: true, value: null });
	await third.delete('present');
	assert.deepEqual(await third.readEntry('present'), { present: false });
});

test('Lightscaper native settings preserve every key code unit rather than UTF8 replacement or C-string truncation', async context => {
	const { settings: s, open } = await fixture(context);
	const keys = ['', '\0', 'a\0b', 'a', '\ud800', '\ud801', '\ufffd', 'ü', ' anchor ', 'selected:one'];
	for (const [index, key] of keys.entries()) assert.equal(await s.put(key, index), index);
	const reopened = (await open()).settingsRepository;
	for (const [index, key] of keys.entries()) assert.equal(await reopened.get(key), index);
	await s.delete('\ud800');
	assert.equal(await s.get('\ud800'), undefined);
	assert.equal(await s.get('\ud801'), 5);
	assert.equal(await s.get('\ufffd'), 6);
});

test('Lightscaper native settings detach admitted inputs, put receipts and every returned value', async context => {
	const { settings: s } = await fixture(context);
	const value = { ordered: { second: 2, first: 1 }, bytes: new Uint8Array([1, 2, 3]) };
	const pending = s.put('snapshot', value);
	value.ordered.first = 90; value.bytes.fill(90);
	const receipt = await pending as typeof value;
	assert.deepEqual(receipt, { ordered: { second: 2, first: 1 }, bytes: new Uint8Array([1, 2, 3]) });
	receipt.ordered.first = 80; receipt.bytes.fill(80);
	const first = await s.get('snapshot') as typeof value;
	assert.deepEqual(first, { ordered: { second: 2, first: 1 }, bytes: new Uint8Array([1, 2, 3]) });
	first.ordered.first = 70; first.bytes.fill(70);
	assert.deepEqual(await s.get('snapshot'), { ordered: { second: 2, first: 1 }, bytes: new Uint8Array([1, 2, 3]) });
});

test('Lightscaper native settings unconditional values remain broader than the CAS grammar', async context => {
	const { settings: s } = await fixture(context);
	const cycle: { self?: unknown; amount: bigint } = { amount: 42n }; cycle.self = cycle;
	await s.put('cycle', cycle);
	const recovered = await s.get('cycle') as typeof cycle;
	assert.equal(recovered.self, recovered); assert.equal(recovered.amount, 42n);
	await assert.rejects(s.replaceIfCurrent('cycle', { amount: 42 }, 'wrong'), /cyclic|canonical/u);
	await assert.rejects(s.deleteIfCurrent('cycle', cycle), /cyclic|canonical/u);
	assert.equal((await s.get('cycle') as typeof cycle).amount, 42n);
	await s.put('undefined', undefined);
	await assert.rejects(s.replaceIfCurrent('undefined', undefined, 1), /canonical/u);
	assert.deepEqual(await s.readEntry('undefined'), { present: true, value: undefined });
});

test('Lightscaper native settings CAS uses insertion order, omission, binary type and lone UTF16 rules', async context => {
	const { settings: s } = await fixture(context);
	await s.put('value', { b: 2, a: 1 });
	assert.equal(await s.replaceIfCurrent('value', { a: 1, b: 2 }, 0), false);
	assert.equal(await s.replaceIfCurrent('value', { b: 2, a: 1, omitted: undefined }, 1), true);
	await s.put('value', { label: '\ud800', bytes: new Uint8Array([5, 6]) });
	assert.equal(await s.replaceIfCurrent('value', { label: '\ud801', bytes: new Uint8Array([5, 6]) }, 0), false);
	assert.equal(await s.replaceIfCurrent('value', { label: '\ud800', bytes: new Int8Array([5, 6]) }, 0), false);
	assert.equal(await s.deleteIfCurrent('value', { label: '\ud800', bytes: new Uint8Array([5, 6]) }), true);
	assert.equal(await s.deleteIfCurrent('value', { label: '\ud800', bytes: new Uint8Array([5, 6]) }), false);
	await s.put('number', Infinity);
	assert.equal(await s.replaceIfCurrent('number', NaN, -0), true);
	assert.equal(Object.is(await s.get('number'), -0), true);
});

test('Lightscaper native settings independent connections have one conditional insert, replace and delete winner', async context => {
	const { settings: a, open } = await fixture(context), b = (await open()).settingsRepository;
	const inserted = await Promise.all([a.putIfAbsent('race', { revision: 0 }), b.putIfAbsent('race', { revision: 0 })]);
	assert.deepEqual(inserted.slice().sort(), [false, true]);
	const replaced = await Promise.all([a.replaceIfCurrent('race', { revision: 0 }, { revision: 1 }),
		b.replaceIfCurrent('race', { revision: 0 }, { revision: 2 })]);
	assert.deepEqual(replaced.slice().sort(), [false, true]);
	const winner = { revision: replaced[0] ? 1 : 2 };
	assert.deepEqual(await (await open()).settingsRepository.get('race'), winner);
	assert.deepEqual((await Promise.all([a.deleteIfCurrent('race', winner), b.deleteIfCurrent('race', winner)])).sort(), [false, true]);
	assert.deepEqual(await a.readEntry('race'), { present: false });
});

test('Lightscaper native settings bind identical logical keys to separate immutable physical generations', async context => {
	const { settings: anchor, open } = await fixture(context), first = (await open('selected:first')).settingsRepository;
	const second = (await open('selected:second')).settingsRepository;
	await anchor.put('same', 'anchor'); await first.put('same', 'first'); await second.put('same', 'second');
	assert.equal(await anchor.get('same'), 'anchor'); assert.equal(await first.get('same'), 'first'); assert.equal(await second.get('same'), 'second');
	await assert.rejects(first.replaceIfCurrentAndPutIfAbsent('same', 'first', 'wrong', 'history', {}), /anchor/u);
	assert.equal(await first.get('same'), 'first');
	assert.deepEqual(await second.readEntry('history'), { present: false });
});

test('Lightscaper native settings persist a full-size preset payload rather than borrowing a small resource-row ceiling', async context => {
	const { settings: s, open, databasePath } = await fixture(context);
	const value = { selectedDevelopPreset: 'x'.repeat(10 * 1024 * 1024) };
	await s.put('preset', value);
	const physical = new DatabaseSync(databasePath, { readOnly: true });
	try { assert.ok((physical.prepare('SELECT length(payload) AS n FROM native_photo_settings').get()?.n as number) > 10 * 1024 * 1024); }
	finally { physical.close(); }
	assert.deepEqual(await (await open()).settingsRepository.get('preset'), value);
});
