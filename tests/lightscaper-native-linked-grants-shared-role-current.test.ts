/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { linkedGrantsFixtureCurrentV1 as fixture, LINKED_GRANT_TEST_OPTIONS_CURRENT_V1 as options,
	GRANTED_FS_OP, grantedFsPathCurrentV1 as path, grantedFsHashCurrentV1 as hash, remainsPending } from './helpers/lightscaper-native-linked-grants-integration-fixture-current.ts';

void test('Lightscaper local grant cancellation joins held ROOT_OPEN without terminating unrelated native roots', options, async context => {
	await fixture(context, async f => {
		const owner = await f.open(), unrelated = await f.root(), caller = new AbortController();
		const reason = Symbol('local grant cancellation'), hold = f.holdNext(GRANTED_FS_OP.rootOpen);
		try {
			const opening = f.track(owner.authorize({ signal: caller.signal })); await f.reached(hold.entered, opening);
			caller.abort(reason); assert.equal(await remainsPending(opening), true);
			hold.release(); await assert.rejects(opening, error => Object.is(error, reason)); await owner.close();
			const file = f.ownNative(await unrelated.openFile([path('photo.bin')]));
			assert.equal(hash(await file.read(0, f.bytes.byteLength)), hash(f.bytes)); assert.equal(f.notifications(), 0);
		} finally { hold.release(); hold.restore(); }
	});
});
