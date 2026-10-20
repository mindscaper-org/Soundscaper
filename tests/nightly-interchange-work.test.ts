/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { relocateNightlyPython, withNightlyInterchangeWork } from '../scripts/lib/nightly-interchange-work.ts';

test('Python relocation waits out transient Windows file locks', async () => {
	const delays: number[] = [];
	let attempts = 0;
	await relocateNightlyPython('temporary/python', 'reference/python', {
		move: (source, destination) => {
			assert.equal(source, 'temporary/python');
			assert.equal(destination, 'reference/python');
			attempts += 1;
			return attempts < 3 ? Promise.reject(Object.assign(new Error('DLL locked'), { code: 'EPERM' })) : Promise.resolve();
		},
		delay: milliseconds => { delays.push(milliseconds); return Promise.resolve(); },
	});
	assert.equal(attempts, 3);
	assert.deepEqual(delays, [250, 500]);
});

test('Python relocation stops on permanent errors and bounds lock retries', async () => {
	for (const code of ['ENOENT', 'EPERM']) {
		const failure = Object.assign(new Error(code), { code });
		let attempts = 0;
		await assert.rejects(relocateNightlyPython('source', 'destination', {
			move: () => { attempts += 1; return Promise.reject(failure); },
			delay: () => Promise.resolve(),
		}), error => error === failure);
		assert.equal(attempts, code === 'ENOENT' ? 1 : 11);
	}
});

test('nightly Python work cleanup retains the provisioning failure when removal also fails', async () => {
	const provisionFailure = new Error('Cannot relocate Python');
	const cleanupFailure = new Error('DLL still locked');
	await assert.rejects(withNightlyInterchangeWork('temporary', () => Promise.reject(provisionFailure), {
		remove: (path, options) => {
			assert.equal(path, 'temporary');
			assert.deepEqual(options, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
			return Promise.reject(cleanupFailure);
		},
	}), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.equal(error.cause, provisionFailure);
		assert.deepEqual(error.errors, [provisionFailure, cleanupFailure]);
		assert.match(error.message, /Cannot relocate Python/u);
		assert.match(error.message, /DLL still locked/u);
		return true;
	});
});

test('nightly Python relocation and cleanup preserve the ready interpreter', async context => {
	const root = await mkdtemp(join(tmpdir(), 'nightly-python-work-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const work = join(root, 'work');
	const source = join(work, 'python');
	const destination = join(root, 'ready-python');
	await mkdir(source, { recursive: true });
	await writeFile(join(source, 'python.exe'), 'portable interpreter');
	assert.equal(await withNightlyInterchangeWork(work, async () => {
		await relocateNightlyPython(source, destination);
		return 'ready';
	}), 'ready');
	assert.equal(await readFile(join(destination, 'python.exe'), 'utf8'), 'portable interpreter');
	await assert.rejects(readFile(source), { code: 'ENOENT' });
});

test('nightly cleanup reports either single failure without replacing it', async () => {
	const failure = new Error('original failure');
	await assert.rejects(withNightlyInterchangeWork('work', () => Promise.reject(failure), {
		remove: () => Promise.resolve(),
	}), error => error === failure);
	await assert.rejects(withNightlyInterchangeWork('work', () => Promise.resolve('ready'), {
		remove: () => Promise.reject(failure),
	}), error => error === failure);
});
