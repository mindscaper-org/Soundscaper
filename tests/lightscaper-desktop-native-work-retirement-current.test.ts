/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { retireLightscaperDesktopNativeWorkCurrentV1 } from
	'../scripts/lightscaper-desktop-native-qualification-current-v1.ts';

const NATIVE_REMOVE_OPTIONS = { recursive: true, force: false, maxRetries: 10, retryDelay: 100 } as const;

test('qualification work retirement removes an actual fresh private directory before resolving', async (context) => {
	const workRoot = await mkdtemp(join(tmpdir(), 'lightscaper-retirement-'));
	context.after(() => rm(workRoot, { recursive: true, force: true }));
	await mkdir(join(workRoot, 'web'));
	await writeFile(join(workRoot, 'web', 'owned-output'), 'owned disposable bytes');

	await retireLightscaperDesktopNativeWorkCurrentV1(workRoot);
	await assert.rejects(lstat(workRoot), { code: 'ENOENT' });
});

test('qualification retirement joins the held native removal acknowledgement with finite retry options', async () => {
	let admit!: () => void;
	const admitted = new Promise<void>((resolve) => { admit = resolve; });
	let acknowledge!: () => void;
	const held = new Promise<void>((resolve) => { acknowledge = resolve; });
	let settled = false;
	let calls = 0;
	let observed: unknown;
	const operation = retireLightscaperDesktopNativeWorkCurrentV1('/owned-qualification', async (path, options) => {
		calls += 1;
		observed = { path, options };
		admit();
		await held;
	}).then(() => { settled = true; });

	try {
		await admitted;
		assert.deepEqual(observed, { path: '/owned-qualification', options: NATIVE_REMOVE_OPTIONS });
		await new Promise<void>((resolve) => { setImmediate(resolve); });
		assert.equal(settled, false, 'work cannot be reported removed before the native operation completes');
		assert.equal(calls, 1, 'the existing native port owns retries, not another packaging attempt');
	} finally { acknowledge(); }
	await operation;
	assert.equal(settled, true);
});

test('qualification retirement preserves an opaque native removal failure without claiming success', async () => {
	const exhausted = Object.freeze({ code: 'EBUSY', identity: Symbol('native-cleanup-failure') });
	let calls = 0;
	let succeeded = false;
	const operation = retireLightscaperDesktopNativeWorkCurrentV1('/owned-qualification', (_path, options) => {
		calls += 1;
		assert.deepEqual(options, NATIVE_REMOVE_OPTIONS);
		return Promise.reject(exhausted);
	}).then(() => { succeeded = true; });

	await assert.rejects(operation, (error: unknown) => error === exhausted);
	assert.equal(calls, 1);
	assert.equal(succeeded, false);
});

test('qualification retirement retains force false for an unexpectedly missing work root', async () => {
	const workRoot = await mkdtemp(join(tmpdir(), 'lightscaper-missing-retirement-'));
	await rm(workRoot, { recursive: true, force: false });
	await assert.rejects(retireLightscaperDesktopNativeWorkCurrentV1(workRoot), { code: 'ENOENT' });
});
