/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

function escapedPattern(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** Run the unchanged named GC regression once when its parent has no GC hook. */
export function runGcRegressionInChild(context: Pick<TestContext, 'name' | 'diagnostic'>, moduleUrl: string): boolean {
	if (typeof globalThis.gc === 'function') return false;
	const environment = { ...process.env };
	// A fresh CLI test runner must not inherit its parent's worker marker.
	delete environment.NODE_TEST_CONTEXT;
	const name = escapedPattern(context.name);
	const child = spawnSync(process.execPath, [
		'--expose-gc', '--max-old-space-size=1024',
		'--import', 'tsx',
		'--import', fileURLToPath(new URL('../../scripts/node-style-asset-loader.mjs', import.meta.url)),
		'--test', '--test-concurrency=1', '--test-timeout=10000', '--test-reporter=tap',
		`--test-name-pattern=^${name}$`, fileURLToPath(moduleUrl),
	], {
		cwd: fileURLToPath(new URL('../../', import.meta.url)), env: environment,
		encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 15_000,
	});
	const output = `${child.stdout}\n${child.stderr}`;
	assert.equal(child.error, undefined, child.error?.message ?? output);
	assert.equal(child.signal, null, output);
	assert.equal(child.status, 0, output);
	assert.equal(child.stdout.match(new RegExp(`^ok \\d+ - ${name}\\r?$`, 'gmu'))?.length, 1, output);
	assert.match(child.stdout, /^# pass 1\r?$/mu, output);
	assert.match(child.stdout, /^# fail 0\r?$/mu, output);
	assert.match(child.stdout, /^# cancelled 0\r?$/mu, output);
	context.diagnostic('The exact GC regression passed with an exposed hook in a bounded child process.');
	return true;
}
