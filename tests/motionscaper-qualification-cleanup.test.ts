/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { withMotionQualificationCleanup } from '../desktop/motionscaper-qualification-cleanup.ts';

async function runtime(context: TestContext): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'motion-qualification-cleanup-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	await writeFile(join(directory, 'application.log'), 'Retained cleanup evidence.');
	return directory;
}

test('Qualification returns its exact value only after awaited cleanup and runtime removal', async context => {
	const directory = await runtime(context), value = Object.freeze({ digest: 'accepted' });
	const order: string[] = [];
	const actual = await withMotionQualificationCleanup(async () => { order.push('work'); return value; }, async () => {
		order.push('cleanup'); assert.equal(await readFile(join(directory, 'application.log'), 'utf8'), 'Retained cleanup evidence.'); order.push('closed');
		return Object.freeze({ physicalClosed: true });
	}, directory);
	assert.equal(actual, value); assert.deepEqual(order, ['work', 'cleanup', 'closed']);
	await assert.rejects(access(directory), { code: 'ENOENT' });
});

test('A primary-only rejection survives by identity after successful cleanup and removal', async context => {
	const directory = await runtime(context), primary = new Error('Linked revision failed'); let closed = 0;
	await assert.rejects(withMotionQualificationCleanup(() => Promise.reject(primary), async () => { closed++; }, directory), error => error === primary);
	assert.equal(closed, 1); await assert.rejects(access(directory), { code: 'ENOENT' });
});

test('A cleanup-only rejection survives by identity and retains the runtime', async context => {
	const directory = await runtime(context), cleanup = new Error('Physical closure refused');
	await assert.rejects(withMotionQualificationCleanup(async () => 'finished', () => Promise.reject(cleanup), directory), error => error === cleanup);
	assert.equal(await readFile(join(directory, 'application.log'), 'utf8'), 'Retained cleanup evidence.');
});

test('Primary and nested cleanup failures remain ordered, original and separately inspectable', async context => {
	const directory = await runtime(context), primary = new Error('First menu readiness failed');
	const leaves = [new Error('Survived graceful closure'), new Error('Controller exit refused'), new Error('Physical closure refused')];
	const cleanup = new AggregateError(leaves, 'Owned application cleanup failed; runtime paths are retained.');
	await assert.rejects(withMotionQualificationCleanup(() => Promise.reject(primary), () => Promise.reject(cleanup), directory), (error: unknown) => {
		assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, cleanup]); assert.equal(error.cause, primary);
		assert.equal(error.errors[1], cleanup); assert.deepEqual(cleanup.errors, leaves); return true;
	});
	await access(join(directory, 'application.log'));
});

test('Synchronous workload and cleanup throws retain both identities and the runtime', async context => {
	const directory = await runtime(context), primary = new Error('Synchronous work failure'), cleanup = new Error('Synchronous close failure');
	const order: string[] = [];
	await assert.rejects(withMotionQualificationCleanup(() => { order.push('work'); throw primary; }, () => { order.push('cleanup'); throw cleanup; }, directory), (error: unknown) => {
		assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, cleanup]); assert.equal(error.cause, primary); return true;
	});
	assert.deepEqual(order, ['work', 'cleanup']); await access(directory);
});

test('Falsey primary and cleanup rejections are not mistaken for successful outcomes', async context => {
	const directory = await runtime(context);
	await assert.rejects(withMotionQualificationCleanup(() => Promise.reject(undefined), () => Promise.reject(false), directory), (error: unknown) => {
		assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [undefined, false]); assert.equal(error.cause, undefined); return true;
	});
	await access(directory);
});

test('An undefined primary-only rejection remains a rejection after successful cleanup', async context => {
	const directory = await runtime(context);
	await assert.rejects(withMotionQualificationCleanup(() => Promise.reject(undefined), async () => undefined, directory), error => error === undefined);
	await assert.rejects(access(directory), { code: 'ENOENT' });
});
