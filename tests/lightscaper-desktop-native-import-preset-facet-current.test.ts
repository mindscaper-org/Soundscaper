/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { LightscaperNativePhotoImportPresetsCurrentV1 as Facet } from '../desktop/lightscaper-native-photo-import-presets-current-v1.ts';
import { applyPhotoImportPresetV1, readPhotoImportPresetsV1, photoImportPresetsKeyV1 } from '../src/lightscaper/storage/photo-import-presets-v1.ts';
import { queryCatalogRootV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { observeNativePhotoSettingsSqlCurrentV1 as observeSql } from './helpers/lightscaper-native-photo-settings-integration-fixture-current.ts';
import { nativeImportPresetFacetFixtureCurrentV1 as fixture, exactNativeImportPresetFailureCurrentV1 as exactFailure,
	observeNativeImportPresetReadCurrentV1 as observeRead } from './helpers/lightscaper-native-import-preset-facet-fixture-current.ts';

const METHODS = ['get', 'readEntry', 'putIfAbsent', 'replaceIfCurrent'] as const;
const options = { timeout: 15_000 };

void test('Lightscaper native import presets vend only four frozen own methods bound to the fixed anchor', options, async context => {
	const f = await fixture(context), { get, readEntry, putIfAbsent, replaceIfCurrent } = f.values;
	assert.deepEqual(Object.keys(f.values).sort(), [...METHODS].sort()); assert.equal(Object.isFrozen(f.values), true);
	for (const key of METHODS) { const descriptor = Object.getOwnPropertyDescriptor(f.values, key); assert.ok(descriptor && Object.hasOwn(descriptor, 'value')); }
	assert.equal(await get(f.key), undefined); assert.deepEqual(await readEntry(f.key), { present: false });
	assert.equal(await putIfAbsent(f.key, { revision: 1, nested: { value: 1 } }), true);
	assert.equal(await replaceIfCurrent(f.key, { revision: 1, nested: { value: 1 } }, { revision: 2 }), true);
	assert.deepEqual(await get(f.key), { revision: 2 });
	const selected = await f.open('selected:library'); assert.deepEqual(await selected.settingsRepository.readEntry(f.key), { present: false });
});

void test('Lightscaper import-preset facet rejects every other key and never exposes selection or history authority', options, async context => {
	const f = await fixture(context); let traps = 0;
	const hostile = new Proxy({}, { ownKeys() { traps++; throw Error('Borrowed payload reflected.'); }, get() { traps++; throw Error('Borrowed key inspected.'); }, getPrototypeOf() { traps++; throw Error('Borrowed prototype inspected.'); } });
	const keys: unknown[] = [photoImportPresetsKeyV1('other'), `${f.key}:extra`, 'photo-library:native-selected-v1',
		'photo-library:native-restore-commit-v1:other', 'photo-library:import:v1:catalog', 'unrelated', hostile];
	for (const key of keys) for (const method of METHODS) {
		const args = method === 'get' || method === 'readEntry' ? [key] : method === 'putIfAbsent' ? [key, hostile] : [key, hostile, hostile];
		await assert.rejects(Reflect.apply(f.values[method], undefined, args) as Promise<unknown>);
	}
	assert.equal(traps, 0); assert.deepEqual(await f.owner.settingsRepository.readEntry(f.key), { present: false });
});

void test('Lightscaper fixed anchor import presets preserve physical undefined occupancy and detached returned values', options, async context => {
	const f = await fixture(context); await f.owner.settingsRepository.put(f.key, undefined);
	assert.equal(await f.values.get(f.key), undefined); assert.deepEqual(await f.values.readEntry(f.key), { present: true, value: undefined });
	assert.equal(await f.values.putIfAbsent(f.key, { replacement: true }), false);
	await assert.rejects(f.values.replaceIfCurrent(f.key, undefined, { nested: { value: 3 } }), TypeError);
	assert.deepEqual(await f.values.readEntry(f.key), { present: true, value: undefined });
	await f.owner.settingsRepository.put(f.key, { nested: { value: 3 } });
	const first = await f.values.get(f.key) as { nested: { value: number } }; first.nested.value = 9;
	assert.deepEqual(await f.values.get(f.key), { nested: { value: 3 } });
});

void test('Lightscaper import-preset facet retains actual canonical CAS order and eager native clone capture', options, async context => {
	const f = await fixture(context); await f.values.putIfAbsent(f.key, { a: 1, b: 2 });
	assert.equal(await f.values.replaceIfCurrent(f.key, { b: 2, a: 1 }, { refused: true }), false);
	const expected = { a: 1, b: 2 }, next = { nested: { value: 4 } };
	const work = f.track(f.values.replaceIfCurrent(f.key, expected, next)); expected.a = 90; next.nested.value = 91;
	assert.equal(await work, true); assert.deepEqual(await f.values.get(f.key), { nested: { value: 4 } });
});

void test('Lightscaper import-preset facet satisfies real domain writers and independent connection CAS without narrowing recipe size', options, async context => {
	const f = await fixture(context), otherOwner = await f.open(), other = f.create(otherOwner), root = queryCatalogRootV1();
	const save = (id: string) => ({ type: 'save', expectedRevision: 0, id, name: id, settings: { rename: null, metadata: { caption: 'x'.repeat(8192) }, keywordIds: ['keyword'] } });
	const results = await Promise.allSettled([applyPhotoImportPresetV1(f.values, root, save('first')), applyPhotoImportPresetV1(other.values, root, save('second'))]);
	assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
	const refused = results.find(result => result.status === 'rejected'); assert.ok(refused && refused.status === 'rejected');
	assert.equal((refused.reason as { code: string }).code, 'IMPORT_PRESET_REVISION_CONFLICT');
	const actual = await readPhotoImportPresetsV1(f.values, 'catalog'); assert.equal(actual.revision, 1); assert.equal(actual.presets.length, 1); assert.equal(actual.presets[0]!.settings.metadata.caption?.length, 8192);
	await f.facet.close(); const fresh = f.create(await f.open()); assert.equal((await readPhotoImportPresetsV1(fresh.values, 'catalog')).revision, 1);
});

void test('Lightscaper import-preset facet refuses a selected settings label as fixed-anchor authority', options, async context => {
	const f = await fixture(context), selected = await f.open('selected:library');
	let facet: Facet | undefined;
	try { facet = Facet.create(selected, 'catalog', { signal: new AbortController().signal, assertCurrent() {} }); await assert.rejects(facet.settingsRepository.putIfAbsent(f.key, { refused: true })); }
	finally { await facet?.close(); }
	assert.deepEqual(await selected.settingsRepository.readEntry(f.key), { present: false });
});

void test('Lightscaper import-preset facet captures native signal and actual method receivers before vending', options, async context => {
	const f = await fixture(context); let traps = 0;
	Object.defineProperty(f.owner, 'executeImportPresetRequestCurrentV1', { configurable: true, value() { throw Error('Late owner method reflected.'); } });
	f.binding.assertCurrent = function () { throw Error('Late epoch method reflected.'); };
	f.binding.signal = new AbortController().signal;
	Object.defineProperties(f.controller.signal, { aborted: { configurable: true, get() { traps++; throw Error('Late aborted getter.'); } }, reason: { configurable: true, get() { traps++; throw Error('Late reason getter.'); } } });
	assert.equal(await f.values.putIfAbsent(f.key, 1), true);
	const reason = Symbol('native original captured signal'); f.controller.abort(reason);
	await exactFailure(f.values.get(f.key), reason); assert.equal(traps, 0);
});

void test('Lightscaper import-preset retirement refuses borrowed payloads before reflection', options, async context => {
	const f = await fixture(context); f.retire(); let reflected = 0;
	const payload = Object.defineProperty({}, 'captured', { enumerable: true, get() { reflected++; throw Error('Retired payload cloned.'); } });
	await exactFailure(f.values.putIfAbsent(f.key, payload), f.retired);
	await exactFailure(f.values.replaceIfCurrent(f.key, payload, payload), f.retired);
	assert.equal(reflected, 0);
	const closed = f.facet.close(); assert.equal(f.facet.close(), closed); await closed;
	await assert.rejects(f.values.putIfAbsent(f.key, payload)); assert.equal(reflected, 0);
});

void test('Lightscaper registers import-preset work before a native clone getter reenters facet Close', options, async context => {
	const f = await fixture(context); let closing: Promise<void> | undefined, retired = false, calls = 0;
	const value = Object.defineProperty({}, 'captured', { enumerable: true, get() { calls++; closing = f.facet.close(); void closing.then(() => { retired = true; }); assert.equal(retired, false); return 1; } });
	const work = f.track(f.values.putIfAbsent(f.key, value)); assert.equal(calls, 1); assert.ok(closing); await assert.rejects(work); await closing;
	assert.deepEqual(await f.owner.settingsRepository.readEntry(f.key), { present: false });
});

void test('Lightscaper import-preset reads recheck the selected epoch after the actual native SQL read', options, async context => {
	const f = await fixture(context); await f.values.putIfAbsent(f.key, 7); const reason = Symbol('retired after actual read');
	await observeRead(f.databasePath, () => { f.retire(reason); }, async () => { await exactFailure(f.values.get(f.key), reason); });
});

for (const method of ['putIfAbsent', 'replaceIfCurrent'] as const) void test(`Lightscaper real ${method} ACK wins late selected retirement and facet Close`, options, async context => {
	const f = await fixture(context); if (method === 'replaceIfCurrent') await f.values.putIfAbsent(f.key, 1);
	let closing: Promise<void> | undefined, commits = 0; const reason = Symbol('late actual COMMIT retirement');
	await observeSql(f.databasePath, (_database, sql) => { if (sql === 'COMMIT') { commits++; f.retire(reason); closing = f.facet.close(); } }, async () => {
		assert.equal(await (method === 'putIfAbsent' ? f.values.putIfAbsent(f.key, 2) : f.values.replaceIfCurrent(f.key, 1, 2)), true);
	});
	assert.equal(commits, 1); assert.ok(closing); await closing; assert.equal(await f.owner.settingsRepository.get(f.key), 2);
});

void test('Lightscaper false import-preset CAS rechecks retirement after actual COMMIT without changing stored bytes', options, async context => {
	const f = await fixture(context); await f.values.putIfAbsent(f.key, 1); const reason = Symbol('late false CAS');
	await observeSql(f.databasePath, (_database, sql) => { if (sql === 'COMMIT') f.retire(reason); }, async () => { await exactFailure(f.values.replaceIfCurrent(f.key, 8, 9), reason); });
	assert.equal(await f.owner.settingsRepository.get(f.key), 1);
});

void test('Lightscaper import-preset admission preserves opaque clone failure and Close joins later real work', options, async context => {
	const f = await fixture(context); let traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('Opaque get'); }, getPrototypeOf() { traps++; throw Error('Opaque prototype'); } });
	const payload = Object.defineProperty({}, 'bad', { enumerable: true, get() { throw reason; } });
	await exactFailure(f.values.putIfAbsent(f.key, payload), reason);
	assert.equal(await f.values.putIfAbsent(f.key, { durable: true }), true); await f.facet.close(); assert.equal(traps, 0);
});
