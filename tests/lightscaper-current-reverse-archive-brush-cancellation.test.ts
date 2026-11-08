/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { observed, readRepairFrameEntries, repairFrameHandoffFixture, type RepairImageReadView } from './helpers/lightscaper-repair-frame-handoff-current-fixture.ts';

test('Current reverse archive joins an escaped brush borrower through opaque cancellation before wiping or retiring it', async t => {
	const f = await repairFrameHandoffFixture('active', true), entered = deferred<void>(), release = deferred<void>();
	const stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	const joins: { work?: ReturnType<typeof observed>; child?: ReturnType<typeof observed> } = {};
	const held: { bytes?: Uint8Array<ArrayBuffer>; expected?: Uint8Array<ArrayBuffer>; view?: Readonly<RepairImageReadView> } = {};
	t.after(async () => { release.resolve(); await joins.work; await joins.child; await f.close(); });

	const before = await f.inspect(), originalBefore = new Uint8Array(await f.records[0]!.original.arrayBuffer());
	const archive = await f.archive(), archiveBefore = new Uint8Array(await archive.blob.arrayBuffer());
	const entries = await readRepairFrameEntries(archive.blob);
	const project = JSON.parse(new TextDecoder().decode(entries.get('project.json'))) as { sources: { id: string }[] };
	assert.equal(project.sources.length, 1); let consumerReturned = false;
	joins.work = observed(f.read(archive.blob, project.sources[0]!.id, view => {
		held.view = view;
		const reference = view.maskRasterReferences[0]; assert.ok(reference);
		held.expected = f.bodies.get(reference.storageKey); assert.ok(held.expected);
		joins.child = observed(view.withMaskRasterBytes(reference, async bytes => {
			held.bytes = bytes; entered.resolve(); await release.promise;
		}));
		consumerReturned = true;
	}, stop.signal));

	assert.equal(await Promise.race([entered.promise.then(() => true), joins.work.then(() => false)]), true);
	assert.equal(consumerReturned, true); assert.ok(held.bytes?.some(value => value !== 0));
	assert.deepEqual(held.bytes, held.expected);
	stop.abort(opaque.proxy);
	assert.equal(await remainsPending(joins.work), true);
	assert.ok(joins.child); assert.equal(await remainsPending(joins.child), true);
	assert.deepEqual(held.bytes, held.expected);

	release.resolve();
	const outcome = await joins.work, child = await joins.child;
	assert.equal(outcome.ok, false); if (!outcome.ok) assert.equal(Object.is(outcome.error, opaque.proxy), true);
	assert.equal(child.ok, false); if (!child.ok) assert.equal(Object.is(child.error, opaque.proxy), true);
	assert.ok(held.bytes?.every(value => value === 0));
	assert.ok(held.view);
	await assert.rejects(held.view.withMaskRasterBytes(held.view.maskRasterReferences[0]!, () => assert.fail('A retired archive reader cannot lend another body.')), /closed|retired/iu);
	assert.deepEqual(new Uint8Array(await held.view.originalBlob.arrayBuffer()), originalBefore);
	assert.deepEqual(new Uint8Array(await archive.blob.arrayBuffer()), archiveBefore);
	assert.deepEqual(new Uint8Array(await f.records[0]!.original.arrayBuffer()), originalBefore);
	assert.deepEqual(await f.inspect(), before);
});
