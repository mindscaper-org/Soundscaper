/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { LightscaperNativePhotoRawTicketsCurrentV1 as Tickets } from '../desktop/lightscaper-native-photo-raw-tickets-current-v1.ts';
import { DesktopPhotoRawSourceCurrentV1 as Client } from '../src/lightscaper/desktop-photo-raw-source-current-v1.ts';
import { nativeRawOriginalsFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-raw-originals-fixture-current.ts';
void test('RAW revision failure after consumer refuses delivery while proved Main retirement leaves output capacity usable', { timeout: 15000 }, async context => {
	await fixture(context, async f => {
		const tickets = Tickets.create({ native: f.native, scope: { signal: f.signal, assertCurrent() { f.signal.throwIfAborted(); } }, unretired() { assert.fail('A revision edit cannot manufacture retirement uncertainty'); } });
		const client = new Client(tickets.transport, { signal: f.signal });
		try {
			await assert.rejects(client.raw.withFrame(f.request(), async () => { await f.components.catalog.savePhoto({ ...f.photo, rating: 3 }, f.photo.revision); }));
			const result = await client.raw.withFrame(f.request('canonical', null), () => 'still usable');
			assert.deepEqual(result, { outcome: 'native', value: 'still usable' }); assert.equal(f.state.alerts, 0); assert.equal(f.activeChildren(), 0);
		} finally { await Promise.allSettled([client.close()]); await tickets.close(); }
	});
});
