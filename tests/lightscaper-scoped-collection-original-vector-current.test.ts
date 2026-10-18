/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { scopedCollectionWebFixtureCurrentV1 as fixture } from './helpers/lightscaper-scoped-collection-originals-web-fixture-current.ts';

test('Scoped collection authenticates distinct returned File bodies even when both Photos alias one locator and digest', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		f.hooks.body = (index, body) => index === 1 ? new File([new Uint8Array(body.size)], body.name, { type: body.type }) : body;
		let consumers = 0;
		const outcome = await f.capture(() => { consumers++; }).then(() => ({ refused: false, error: undefined as unknown }),
			(error: unknown) => ({ refused: true, error }));
		assert.equal(f.calls().groups, 1); assert.equal(f.calls().closes, 1); assert.equal(f.requests[0]!.length, 2);
		assert.equal(f.requests[0]![0]!.original.storageKey, f.requests[0]![1]!.original.storageKey);
		assert.equal(f.requests[0]![0]!.original.contentSha256, f.requests[0]![1]!.original.contentSha256);
		assert.equal(outcome.refused, true); assert.equal(consumers, 0); assert.match(String(outcome.error), /identity|hash|SHA/iu);
	}, { count: 2, mixed: false });
});
