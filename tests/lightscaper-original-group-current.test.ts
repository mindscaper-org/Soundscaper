/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { capturePhotoLibraryOriginalSourceCurrentV1 as capture,
	type PhotoLibraryOriginalSourceCurrentV1 as Source, type PhotoLibraryOriginalRequestCurrentV1 as Request,
	type PhotoLibraryOriginalGroupLeaseCurrentV1 as Group } from '../src/lightscaper/controller/photo-library-original-source-current-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { remainsPending } from './helpers/async-test-control.ts';

const groupModule = () => import('../src/lightscaper/controller/photo-library-original-group-current-v1.ts');
const planModule = () => import('../src/lightscaper/controller/photo-library-original-group-contract-current-v1.ts');
const bytes = Uint8Array.of(1, 2, 3), file = new File([bytes], 'Owned.bin');
function request(index = 1): Request { const { photo } = photoArchiveFixture(index, bytes); return { catalogId: photo.catalogId, photoId: photo.id, original: { ...photo.original } }; }
function fixture(context: TestContext) {
	const releases = new Set<() => void>(), work = new Set<Promise<unknown>>(), stop = new AbortController();
	const release = () => { for (const finish of releases) finish(); stop.abort(context.signal.reason); };
	context.signal.addEventListener('abort', release, { once: true }); if (context.signal.aborted) release();
	return { stop,
		gate() { let finish!: () => void; const promise = new Promise<void>(resolve => { finish = resolve; });
			const open = () => { finish(); releases.delete(open); }; releases.add(open); if (stop.signal.aborted) open(); return { promise, open }; },
		track<Value>(task: Promise<Value>) { work.add(task); void task.then(() => { work.delete(task); }, () => { work.delete(task); }); return task; },
		async close() { release(); await Promise.allSettled([...work]); context.signal.removeEventListener('abort', release); },
	};
}
const outcome = <Value>(work: Promise<Value>) => work.then(value => ({ okay: true as const, value }), (error: unknown) => ({ okay: false as const, error }));
function source(raw: unknown, acquired: () => void = () => undefined): Source {
	return { async acquire() { assert.fail('A collection may not acquire a per-file prefix.'); },
		async acquireGroup() { acquired(); return raw as Group; } };
}

void test('Original source capture retains a group method and its receiver independently of per-file acquisition', { timeout: 15_000 }, async () => {
	let calls = 0;
	const owner = { async acquire() { assert.fail('Per-file path invoked.'); }, async acquireGroup() {
		assert.equal(this, owner); calls++; return { bodies: [file], close: async () => undefined };
	} };
	const captured = capture(owner), method = Reflect.get(captured, 'acquireGroup') as unknown;
	assert.equal(typeof method, 'function'); owner.acquireGroup = async () => { assert.fail('Replaced group method invoked.'); };
	const { acquirePhotoLibraryOriginalGroupCurrentV1: acquire } = await groupModule();
	const lease = await acquire(captured, [request()]); assert.equal(lease.bodies.length, 1); assert.equal(calls, 1);
	const first = lease.close(); assert.equal(first, lease.close()); await first;
});

void test('Original group detaches every Photo authority before yielding, including same-digest locator aliases', { timeout: 15_000 }, async context => {
	const f = fixture(context), entered = f.gate(), release = f.gate(), input = [request(1), request(2)]; let retained: readonly Request[] | undefined;
	const owner: Source = { async acquire() { assert.fail('Per-file prefix.'); }, async acquireGroup(requests) {
		retained = requests; entered.open(); await release.promise; return { bodies: [file, file], close: async () => undefined };
	} };
	try {
		const { acquirePhotoLibraryOriginalGroupCurrentV1: acquire } = await groupModule();
		const work = f.track(acquire(capture(owner), input, f.stop.signal));
		await Promise.race([entered.promise, work.then(() => { assert.fail('No acquisition receipt.'); })]); context.signal.throwIfAborted();
		input.reverse(); Reflect.set(input[0]!.original, 'name', 'Replacement'); release.open(); const lease = await work;
		assert.equal(retained?.[0]?.photoId, request(1).photoId); assert.equal(retained?.[1]?.photoId, request(2).photoId);
		assert.equal(retained?.[1]?.original.name, request(2).original.name); assert.ok(Object.isFrozen(retained?.[1]?.original));
		assert.equal(lease.bodies.length, 2); await lease.close();
	} finally { release.open(); await f.close(); }
});

void test('Original group retains all Files through its real consumer and held group retirement', { timeout: 15_000 }, async context => {
	const f = fixture(context), entered = f.gate(), consume = f.gate(), retiring = f.gate(), retire = f.gate(); let closes = 0;
	try {
		const { withPhotoLibraryOriginalGroupCurrentV1: withGroup } = await groupModule();
		const work = f.track(withGroup(source({ bodies: [file, file], async close() { closes++; retiring.open(); await retire.promise; } }),
			[request(1), request(2)], async bodies => { assert.equal(bodies.length, 2); entered.open(); await consume.promise; return 'joined'; }, f.stop.signal));
		await Promise.race([entered.promise, work]); context.signal.throwIfAborted(); assert.equal(closes, 0);
		consume.open(); await Promise.race([retiring.promise, work]); assert.equal(await remainsPending(work), true);
		retire.open(); assert.equal(await work, 'joined'); assert.equal(closes, 1);
	} finally { consume.open(); retire.open(); await f.close(); }
});

void test('Original group cancellation joins late acquisition and cleanup without inspecting an opaque reason', { timeout: 15_000 }, async context => {
	const f = fixture(context), entered = f.gate(), release = f.gate(), retiring = f.gate(), retire = f.gate(); let deliveries = 0, closes = 0, traps = 0;
	const reason = new Proxy({}, { get() { traps++; assert.fail('Opaque reason read.'); }, getPrototypeOf() { traps++; assert.fail('Opaque reason reflected.'); } });
	try {
		const { withPhotoLibraryOriginalGroupCurrentV1: withGroup } = await groupModule();
		const owner: Source = { async acquire() { assert.fail('Per-file prefix.'); }, async acquireGroup() {
			entered.open(); await release.promise; return { bodies: [file], async close() { closes++; retiring.open(); await retire.promise; } };
		} };
		const work = f.track(withGroup(owner, [request()], () => { deliveries++; }, f.stop.signal)), observed = outcome(work);
		await Promise.race([entered.promise, work]); context.signal.throwIfAborted(); f.stop.abort(reason); assert.equal(await remainsPending(work), true);
		release.open(); await Promise.race([retiring.promise, observed]); assert.equal(await remainsPending(work), true); retire.open();
		const result = await observed; assert.equal(result.okay, false); if (!result.okay) assert.equal(Object.is(result.error, reason), true);
		assert.equal(deliveries, 0); assert.equal(closes, 1); assert.equal(traps, 0);
	} finally { release.open(); retire.open(); await f.close(); }
});

void test('Original group refuses incomplete or nongenuine body vectors and still joins exact cleanup once', { timeout: 15_000 }, async () => {
	const { acquirePhotoLibraryOriginalGroupCurrentV1: acquire } = await groupModule(); let getters = 0;
	const accessor = Object.defineProperty([file], '0', { enumerable: true, get() { getters++; assert.fail('Body accessor invoked.'); } });
	for (const bodies of [[], [file, file], [new Blob([Uint8Array.of(0)])], [{ size: 3 }], accessor]) {
		let closes = 0; await assert.rejects(acquire(source({ bodies, async close() { closes++; } }), [request()])); assert.equal(closes, 1);
	}
	assert.equal(getters, 0);
});

for (const same of [false, true]) void test(`Original group preserves ${same ? 'identical' : 'distinct'} opaque consumer and cleanup failures`, { timeout: 15_000 }, async () => {
	const { withPhotoLibraryOriginalGroupCurrentV1: withGroup } = await groupModule(); const primary = Symbol('Consumer'), cleanup = same ? primary : Symbol('Cleanup');
	const result = await outcome(withGroup(source({ bodies: [file], async close() { throw cleanup; } }), [request()], () => { throw primary; }));
	assert.equal(result.okay, false); if (result.okay) assert.fail('Expected failure.');
	if (same) assert.equal(Object.is(result.error, primary), true);
	else { assert.ok(result.error instanceof AggregateError); assert.equal(result.error.errors.length, 2);
		assert.equal(Object.is(result.error.errors[0], primary), true); assert.equal(Object.is(result.error.errors[1], cleanup), true); }
});

void test('Original group admission refuses hostile, conflicting or oversized requests before invoking the source', { timeout: 15_000 }, async () => {
	const { acquirePhotoLibraryOriginalGroupCurrentV1: acquire } = await groupModule(); let acquisitions = 0, getters = 0;
	const owner = source({ bodies: [], close: async () => undefined }, () => { acquisitions++; }), one = request(1), two = request(2);
	const sparse = new Array<Request>(1), accessor = Object.defineProperty([one], '0', { enumerable: true, get() { getters++; return one; } });
	for (const vector of [sparse, accessor, Object.assign([one], { extra: true }), [one, one], [one, { ...two, catalogId: 'foreign' }],
		[one, { ...two, original: { ...two.original, width: two.original.width + 1 } }],
		[one, { ...two, original: { ...two.original, storageKey: one.original.storageKey, contentSha256: 'a'.repeat(64) } }],
		Array.from({ length: 4095 }, () => one)]) await assert.rejects(acquire(owner, vector));
	assert.equal(acquisitions, 0); assert.equal(getters, 0);
	const metadata = Array.from({ length: 2500 }, (_, index) => ({ ...one, photoId: `group-${index}`,
		original: { ...one.original, name: 'Ж'.repeat(512) } }));
	await assert.rejects(acquire(owner, metadata), /request byte capacity/iu); assert.equal(acquisitions, 0);
	await assert.rejects(acquire({ acquire: async () => ({ body: file, close: async () => undefined }) }, [one]), /group/iu);
});

void test('Original group capacity counts unique compatible digests while retaining every Photo and locator', { timeout: 15_000 }, async () => {
	const { readPhotoLibraryOriginalGroupCurrentV1: plan } = await planModule();
	const first = request(1), second = request(2), length = 200 * 1024 * 1024;
	const group = plan([{ ...first, original: { ...first.original, byteLength: length } }, { ...second, original: { ...second.original, byteLength: length } }]);
	assert.equal(group.requests.length, 2); assert.equal(group.uniqueEncodedBytes, length); assert.deepEqual(group.representatives, [0, 0]);
	assert.throws(() => plan([{ ...first, original: { ...first.original, byteLength: length } },
		{ ...second, original: { ...second.original, byteLength: length, contentSha256: 'a'.repeat(64) } }]), /capacity|bytes/iu);
});

void test('Original group keeps durable Web fallback with one genuine body load per storage key', { timeout: 15_000 }, async () => {
	const { withPhotoLibraryOriginalGroupCurrentV1: withGroup } = await groupModule(); let loads = 0;
	const first = request(1), second = { ...request(2), original: { ...first.original } };
	const owner = capture(undefined, async () => { loads++; return file; });
	assert.equal(await withGroup(owner, [first, second], bodies => bodies.reduce((total, body) => total + body.size, 0)), 6); assert.equal(loads, 1);
	assert.equal(await withGroup(owner, [], bodies => bodies.length), 0); assert.equal(loads, 1);
});
