/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeMediaRestoreFixtureCurrentV1 as fixture, remainsPending } from './helpers/lightscaper-native-media-restore-integration-fixture-current.ts';

void test('Native restore abort joins held real producer next and return before child close settles, retaining exact opaque caller reason', { timeout: 15_000 }, async context => {
	const stop = new AbortController(), reason = Symbol('Native restore producer cancelled');
	await fixture(context, async f => {
		const next = f.gate(), returned = f.gate(); let visits = 0;
		const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { return {
			async next() { visits++; await next.hold(); return { done: false, value: f.values[0]! }; },
			async return() { await returned.hold(); return { done: true, value: undefined }; },
		}; } };
		const work = f.writeOriginal(0, source), outcome = work.then(() => ({ failed: false, error: undefined as unknown }), (error: unknown) => ({ failed: true, error }));
		try {
			await f.reached(next.entered, work); assert.equal(visits, 1); stop.abort(reason); const closing = f.media.close();
			assert.equal(await remainsPending(work), true); assert.equal(await remainsPending(closing), true);
			next.release(); await f.reached(returned.entered, work); assert.equal(await remainsPending(closing), true);
			returned.release(); const result = await outcome; assert.equal(result.failed, true); assert.equal(Object.is(result.error, reason), true); await closing;
		} finally { next.release(); returned.release(); await Promise.allSettled([work, outcome]); }
	}, { signal: stop.signal });
});

void test('Native restore close joins actual held FileHandle.write and physical cleanup before generation can retire', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		await f.holdWrite(async control => {
			const work = f.writeOriginal(0), observed = work.then(() => ({ failed: false }), () => ({ failed: true }));
			try { await f.reached(control.entered, work); const closing = f.media.close();
				assert.equal(await remainsPending(work), true); assert.equal(await remainsPending(closing), true); control.release();
				assert.equal((await observed).failed, true); await closing;
			} finally { control.release(); await Promise.allSettled([work, observed]); }
		});
	});
});

void test('Native restore refuses concurrent child writes without cancelling accepted actual stream work', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const hold = f.gate(); const source: AsyncIterable<Uint8Array> = { async *[Symbol.asyncIterator]() { await hold.hold(); yield f.values[0]!; } };
		const first = f.writeOriginal(0, source); void first.catch(() => undefined);
		try { await f.reached(hold.entered, first); await assert.rejects(f.writeOriginal(1), /pending|busy|active/iu);
			assert.equal(await remainsPending(first), true); hold.release(); assert.equal((await first).assetId, f.photos[0]!.original.storageKey);
		} finally { hold.release(); await Promise.allSettled([first]); }
	});
});

void test('Native restore caches close and fences every child frontdoor before borrowed input reflection', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const first = f.media.close(), second = f.media.close(); assert.equal(first, second); await first;
		let traps = 0; const poison = new Proxy({}, { ownKeys() { traps++; throw new Error('Closed reflection'); }, getOwnPropertyDescriptor() { traps++; throw new Error('Closed reflection'); },
			get() { traps++; throw new Error('Closed reflection'); }, getPrototypeOf() { traps++; throw new Error('Closed reflection'); } });
		for (const [method, args] of [[f.media.writeOriginal, [poison, poison]], [f.media.writeDevelopPresets, [poison]],
			[f.media.writeLut, [poison, poison]], [f.media.writeMaskRaster, [poison, poison]], [f.media.finish, [poison]]] as const) {
			await assert.rejects(Reflect.apply(method, f.media, args) as Promise<unknown>);
		}
		assert.equal(traps, 0);
	});
});
