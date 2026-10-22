/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { fixture, test } from './helpers/lightscaper-native-restore-claim-fixture-current.ts';
void test('Native selected options capture preserves known native cancellation when a late descriptor throws', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const stop = new AbortController(), reason = Symbol('owning selected cancellation'), borrowed = Symbol('borrowed descriptor failure'); let names = 0;
		const options = new Proxy({ name: 'Native', signal: stop.signal }, { getOwnPropertyDescriptor(target, key) {
			if (key === 'name' && ++names === 3) { stop.abort(reason); throw borrowed; }
			return Reflect.getOwnPropertyDescriptor(target, key);
		} });
		let failed = false;
		await f.scopes.openSelected(options).then(() => assert.fail('Admission must fail.'), (error: unknown) => { failed = true; assert.equal(error, reason); });
		assert.equal(failed, true); assert.equal(names, 3); assert.equal((await f.scopes.readAllocationPage()).allocations.length, 0);
	});
});
void test('Native archive nested reader admission preserves known cancellation before any provider IO', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const stop = new AbortController(), reason = Symbol('owning reader admission cancellation'), borrowed = Symbol('borrowed reader failure'); let reflected = 0, reads = 0;
		const readers = new Proxy({ blob: () => { reads++; throw new Error('No archive reader may run.'); } }, { ownKeys() { reflected++; stop.abort(reason); throw borrowed; } });
		let failed = false;
		await f.scopes.restoreArchive(new Blob(), { name: 'Native', signal: stop.signal, readerFactories: readers }).then(() => assert.fail('Admission must fail.'), (error: unknown) => { failed = true; assert.equal(error, reason); });
		assert.equal(failed, true); assert.equal(reflected, 1); assert.equal(reads, 0); assert.equal((await f.scopes.readAllocationPage()).allocations.length, 0);
	});
});
