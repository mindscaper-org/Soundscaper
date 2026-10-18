/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { fixture, test, begin, openComponent, inspect } from './helpers/lightscaper-native-restore-claim-fixture-current.ts';

void test('Native restore preserves borrowed AggregateError without minting a native cleanup witness', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const candidate = await begin(f.scopes), reason = new AggregateError([Symbol('borrowed reason')], 'Borrower admission refused.');
		let reflections = 0;
		const options = new Proxy({}, { ownKeys() { reflections++; throw reason; } });
		await openComponent(candidate.catalogClaim, 'catalog', () => {
			// Borrowed admission precedes any native constructor or file IO.
			Reflect.ownKeys(options); throw new Error('Unreachable.');
		}).then(() => assert.fail('Admission must fail.'), (error: unknown) => { assert.equal(error, reason); });
		assert.equal(reflections, 1); await candidate.close(); (await inspect(candidate)).assertRetired();
		candidate.retireRole('unpublished');
		const next = await begin(f.scopes, 'after-borrowed-failure'); await next.close();
	});
});
