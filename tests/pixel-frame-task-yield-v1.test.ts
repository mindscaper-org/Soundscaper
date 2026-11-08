/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { yieldPixelFrameTaskV1 } from '../src/common/editor/imaging/pixel-frame-task-yield-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const OPTIONS = { concurrency: false, timeout: 10_000 };

async function withScheduler(value: unknown, run: (timerCalls: () => number) => Promise<void>): Promise<void> {
	const scheduler = Object.getOwnPropertyDescriptor(globalThis, 'scheduler'), nativeTimer = globalThis.setTimeout;
	let calls = 0;
	Object.defineProperty(globalThis, 'scheduler', { configurable: true, value });
	globalThis.setTimeout = new Proxy(nativeTimer, { apply(target, receiver, args) {
		calls++; return Reflect.apply(target, receiver, args) as ReturnType<typeof setTimeout>;
	} });
	try { await run(() => calls); }
	finally {
		globalThis.setTimeout = nativeTimer;
		if (scheduler) Object.defineProperty(globalThis, 'scheduler', scheduler);
		else Reflect.deleteProperty(globalThis, 'scheduler');
	}
}

test('pixel task yield preserves the native scheduler receiver and joins its controlled continuation', OPTIONS, async () => {
	const entered = deferred<void>(), release = deferred<void>(); let calls = 0;
	const scheduler = { yield(this: unknown): Promise<void> {
		assert.equal(this, scheduler); calls++; entered.resolve(); return release.promise;
	} };
	await withScheduler(scheduler, async timerCalls => {
		const work = yieldPixelFrameTaskV1().then(() => ({ outcome: 'success' as const }),
			(failure: unknown) => ({ outcome: 'failure' as const, failure }));
		try {
			await Promise.race([entered.promise, work]); assert.equal(calls, 1);
			assert.equal(await remainsPending(work), true, 'A pending native continuation must remain joined.');
			assert.equal(timerCalls(), 0); release.resolve();
			const result = await work; if (result.outcome === 'failure') throw result.failure;
			assert.equal(calls, 1); assert.equal(timerCalls(), 0);
		} finally { release.resolve(); await work; }
	});
});

for (const [name, value] of [['absent scheduler', undefined], ['absent yield method', {}], ['noncallable yield method', { yield: 7 }]] as const) {
	test(`pixel task yield joins one real timer for ${name}`, OPTIONS, async () => {
		await withScheduler(value, async timerCalls => {
			let completed = false;
			const work = yieldPixelFrameTaskV1().then(() => { completed = true; return { outcome: 'success' as const }; },
				(failure: unknown) => ({ outcome: 'failure' as const, failure }));
			try {
				assert.equal(timerCalls(), 1); await Promise.resolve();
				assert.equal(completed, false, 'The fallback must cross a native timer task, not resolve in a microtask.');
				const result = await work; if (result.outcome === 'failure') throw result.failure;
				assert.equal(completed, true); assert.equal(timerCalls(), 1);
			} finally { await work; }
		});
	});
}

for (const mode of ['synchronous throw', 'promise rejection'] as const) {
	test(`pixel task yield preserves opaque native ${mode} without timer fallback`, OPTIONS, async () => {
		const reason = Proxy.revocable({}, {}); reason.revoke(); let calls = 0;
		const scheduler = { yield(this: unknown): Promise<void> {
			assert.equal(this, scheduler); calls++;
			if (mode === 'synchronous throw') throw reason.proxy;
			return Promise.reject(reason.proxy);
		} };
		await withScheduler(scheduler, async timerCalls => {
			const result = await yieldPixelFrameTaskV1().then(() => ({ outcome: 'success' as const }),
				(failure: unknown) => ({ outcome: 'failure' as const, failure }));
			assert.equal(result.outcome, 'failure');
			if (result.outcome === 'failure') assert.equal(Object.is(result.failure, reason.proxy), true);
			assert.equal(calls, 1); assert.equal(timerCalls(), 0);
		});
	});
}
