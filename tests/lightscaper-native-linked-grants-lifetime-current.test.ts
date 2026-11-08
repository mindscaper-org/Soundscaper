/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { linkedGrantsFixtureCurrentV1 as fixture, LINKED_GRANT_TEST_OPTIONS_CURRENT_V1 as options,
	grantAuthorizeCurrentV1 as authorize, GRANTED_FS_OP, grantedFsPathCurrentV1 as path,
	grantedFsHashCurrentV1 as hash, remainsPending, invokeGrantUnknownCurrentV1 as invoke } from './helpers/lightscaper-native-linked-grants-integration-fixture-current.ts';

void test('Lightscaper grant close joins an actual held root-close receipt and leaves unrelated role roots usable', options, async context => {
	await fixture(context, async f => {
		const owner = await f.open(), unrelated = await f.root(), hold = f.holdNext(GRANTED_FS_OP.rootClose);
		try {
			const authorizing = f.track(owner.authorize()); await f.reached(hold.entered, authorizing);
			const closing = f.track(owner.close()); assert.equal(closing, owner.close()); assert.equal(await remainsPending(closing), true);
			let traps = 0; const poison = new Proxy({}, { ownKeys() { traps++; throw new Error('closed'); }, get() { traps++; throw new Error('closed'); } });
			for (const [method, args] of [['authorize', [poison]], ['revalidate', [poison, poison]], ['readPage', [null, poison]], ['revoke', [poison, poison]]] as const) {
				await assert.rejects(invoke(owner, method, args));
			}
			assert.equal(traps, 0); hold.release(); await assert.rejects(authorizing); await closing;
			const file = f.ownNative(await unrelated.openFile([path('photo.bin')])); assert.equal(hash(await file.read(0, f.bytes.byteLength)), hash(f.bytes));
		} finally { hold.release(); hold.restore(); }
	});
});

void test('Lightscaper revoke fences and joins its actual revalidation root without stopping the shared native role', options, async context => {
	await fixture(context, async f => {
		const owner = await f.open(), grant = await authorize(owner), hold = f.holdNext(GRANTED_FS_OP.rootClose);
		try {
			const validating = f.track(owner.revalidate(grant.grantId)); await f.reached(hold.entered, validating);
			const revoking = f.track(owner.revoke(grant.grantId)); assert.equal(await remainsPending(revoking), true);
			hold.release(); await assert.rejects(validating); assert.equal(await revoking, true);
			assert.equal((await owner.revalidate(grant.grantId))?.revoked, true);
			const independent = await f.root(); await independent.close(); assert.equal(f.notifications(), 0);
		} finally { hold.release(); hold.restore(); }
	});
});

void test('Lightscaper grant registration precedes options Proxy close reentry and preserves the exact opaque capture reason', options, async context => {
	await fixture(context, async f => {
		const owner = await f.open(), reason = Symbol('grant options capture'), opened = f.count(GRANTED_FS_OP.rootOpen);
		let closing: Promise<void> | undefined, traps = 0;
		const reenter = (): never => { traps++; closing = owner.close(); throw reason; };
		const optionsValue = new Proxy({}, { ownKeys: reenter, get: reenter, getOwnPropertyDescriptor: reenter });
		await assert.rejects(invoke(owner, 'authorize', [optionsValue]), error => Object.is(error, reason));
		assert.ok(closing); await closing; assert.equal(traps, 1); assert.equal(f.count(GRANTED_FS_OP.rootOpen), opened);
	});
});

void test('Lightscaper grant four-operation admission has no queued fifth chooser and independent close joins all accepted callbacks', options, async context => {
	await fixture(context, async f => {
		const release = f.gate(), entered = f.gate(); let calls = 0;
		const owner = await f.open(async () => { calls++; if (calls === 4) entered.release(); await release.promise; return f.selected; });
		const accepted = Array.from({ length: 4 }, () => f.track(owner.authorize()));
		try {
			await f.reached(entered.promise, Promise.all(accepted)); await assert.rejects(owner.authorize(), /busy|capacity/iu); assert.equal(calls, 4);
			const closing = f.track(owner.close()); assert.equal(await remainsPending(closing), true); release.release();
			const results = await Promise.allSettled(accepted); assert.equal(results.filter(result => result.status === 'rejected').length, 4); await closing;
		} finally { release.release(); await Promise.allSettled(accepted); }
	});
});

void test('Lightscaper grant caller abort preserves its native opaque reason after joining an actual held root close', options, async context => {
	await fixture(context, async f => {
		const owner = await f.open(), caller = new AbortController(), reason = Object.freeze({ tag: 'opaque caller reason' });
		const hold = f.holdNext(GRANTED_FS_OP.rootClose);
		try {
			const accepted = f.track(owner.authorize({ signal: caller.signal })); await f.reached(hold.entered, accepted); caller.abort(reason);
			assert.equal(await remainsPending(accepted), true); hold.release(); await assert.rejects(accepted, error => Object.is(error, reason));
			assert.deepEqual(await owner.readPage(), { grants: [], afterGrantId: null }); assert.equal(f.notifications(), 0);
		} finally { hold.release(); hold.restore(); }
	});
});

void test('Lightscaper grant captures chooser path bytes and presentation before held actual root cleanup', options, async context => {
	await fixture(context, async f => {
		const selected = { path: { encoding: f.selected.path.encoding, bytes: new Uint8Array(f.selected.path.bytes) }, displayName: 'Captured native root' };
		const owner = await f.open(async () => selected), hold = f.holdNext(GRANTED_FS_OP.rootClose);
		try {
			const accepted = f.track(owner.authorize()); await f.reached(hold.entered, accepted);
			selected.path.bytes.fill(0); selected.displayName = 'Retargeted after native proof'; hold.release();
			const grant = await accepted; assert.ok(grant); assert.equal(grant.displayName, 'Captured native root');
			assert.deepEqual(await owner.revalidate(grant.grantId), grant);
		} finally { hold.release(); hold.restore(); }
	});
});

void test('Lightscaper preaborted native caller refuses before chooser IO without reflecting its opaque reason', options, async context => {
	await fixture(context, async f => {
		let calls = 0, traps = 0; const owner = await f.open(async () => { calls++; return f.selected; }), caller = new AbortController();
		const reason = new Proxy({}, { ownKeys() { traps++; return []; }, get() { traps++; throw new Error('opaque reason reflected'); } }); caller.abort(reason);
		let refused = false;
		try { await owner.authorize({ signal: caller.signal }); } catch (error) { refused = true; assert.equal(Object.is(error, reason), true); }
		assert.equal(refused, true); assert.equal(calls, 0); assert.equal(traps, 0);
	});
});
