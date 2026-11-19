/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { photoImportIntentKeyV1 } from '../src/lightscaper/import/import-intent-v1.ts';
import { nativeSessionProtocolFixtureCurrentV1 as fixture, channels, OPEN_ID } from './helpers/lightscaper-native-session-protocol-integration-fixture-current.ts';
const options = { timeout: 15_000 };

void test('Actual Main service authenticates exact document before reflection and consumes monotonic request IDs before domain capture', options, async context => {
	await fixture(context, async f => {
		assert.equal(f.descriptor.kind, 'desktop-photo-session'); assert.equal(f.descriptor.catalogId, f.selected.catalogId);
		let reflected = 0; const poison = new Proxy({}, { ownKeys() { reflected++; throw new Error('Untrusted payload reflection.'); } });
		await assert.rejects(f.service.dispatch(channels.catalog, {}, poison)); assert.equal(reflected, 0);
		const packet = f.envelope({ operation: 'load' }); const root = await f.service.dispatch(channels.catalog, f.owner, packet);
		assert.ok(root && typeof root === 'object'); assert.equal(Reflect.get(root, 'id'), f.selected.catalogId);
		await assert.rejects(f.service.dispatch(channels.catalog, f.owner, { identity: packet.identity, payload: poison })); assert.equal(reflected, 0);
		await assert.rejects(f.call(channels.catalog, { operation: 'storeOriginal', path: '/foreign' }));
		await assert.rejects(f.service.dispatch(channels.stop, f.owner, { openId: 'b'.repeat(64) }));
		await f.service.dispatch(channels.close, f.owner, { openId: OPEN_ID }); await assert.rejects(f.call(channels.catalog, { operation: 'load' }));
	});
});

void test('Actual Main service supplies native catalog/query/stack/saved/custody families without reflected method dispatch', options, async context => {
	await fixture(context, async f => {
		const photo = await f.call(channels.catalog, { operation: 'load-photo', photoId: f.photos[0]!.id }); assert.ok(photo);
		const page = await f.call(channels.catalog, { operation: 'summaries', request: {} }); assert.ok(page && typeof page === 'object');
		assert.equal((await f.call(channels.query, { operation: 'rebuild-v1' })) !== undefined, true);
		assert.equal((await f.call(channels.query, { operation: 'rebuild-v2' })) !== undefined, true);
		assert.ok(await f.call(channels.stacks, { operation: 'state' })); assert.ok(await f.call(channels.saved, { operation: 'state' }));
		const roots = await f.call(channels.custody, { operation: 'page', importId: null, afterKey: null }); assert.ok(roots);
		await assert.rejects(f.call(channels.catalog, { operation: 'load-photo', photoId: f.photos[0]!.id, catalogId: 'foreign' }));
	});
});

void test('Actual Main fixed Settings domains preserve physical undefined and bound occupied intent before decode', options, async context => {
	await fixture(context, async f => {
		const settings = f.components.settings.settingsRepository, key = photoImportIntentKeyV1(f.selected.catalogId);
		{
			await settings.put(key, undefined);
			const entry = await f.call(channels.settings, { operation: 'read-entry', domain: 'import-intent' }); assert.deepEqual(entry, { present: true, value: undefined });
			await assert.rejects(f.call(channels.settings, { operation: 'read-import-intent' }), TypeError);
			await settings.put(key, new Blob([new Uint8Array(8192)]));
			await assert.rejects(f.call(channels.settings, { operation: 'read-entry', domain: 'import-intent' }), RangeError);
			await assert.rejects(f.call(channels.settings, { operation: 'get', domain: 'native-selection-pointer' }));
		}
	});
});

void test('Actual Main exclusive callback lane admits only its child identity and ends outside the children it joins', options, async context => {
	await fixture(context, async f => {
		const receipt = await f.call(channels.exclusive, { operation: 'begin' }); assert.ok(receipt && typeof receipt === 'object');
		const handle = Reflect.get(receipt, 'handle'); assert.ok(handle && typeof handle === 'object'); const id = Reflect.get(handle, 'id'); assert.equal(typeof id, 'string');
		try { await assert.rejects(f.call(channels.catalog, { operation: 'load' })); assert.ok(await f.call(channels.catalog, { operation: 'load' }, String(id))); }
		finally { await f.call(channels.exclusive, { operation: 'end', handle }, String(id)); }
		assert.ok(await f.call(channels.catalog, { operation: 'load' }));
	});
});
