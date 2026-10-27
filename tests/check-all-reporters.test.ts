/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import type { TestCase, TestResult } from '@playwright/test/reporter';

import CheckAllBrowserReporter from '../scripts/check-all-browser-reporter.ts';
import { createCheckOutputReader, type CheckProgress } from '../scripts/lib/check-all-output.ts';

const root = resolve(import.meta.dirname, '..');

test('Node reporter reports a fast failure before an earlier slow file completes and omits passing result lines', { timeout: 10_000 }, async context => {
	const directory = await mkdtemp(join(tmpdir(), 'scape-check-reporter-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	await writeFile(join(directory, 'a.test.mjs'), `import test from 'node:test'; import {setTimeout} from 'node:timers/promises'; test('slow first file', async () => { await setTimeout(600); });`);
	await writeFile(join(directory, 'b.test.mjs'), `import test from 'node:test'; import assert from 'node:assert/strict'; test('fast failure', () => assert.equal(1, 2)); test('quiet success', () => {});`);
	const events: CheckProgress[] = [];
	let output = '';
	const reader = createCheckOutputReader(event => events.push(event));
	const env = { ...process.env };
	delete env.NODE_TEST_CONTEXT;
	const child = spawn(process.execPath, ['--test', '--test-concurrency=2', '--test-reporter',
		resolve(root, 'scripts/check-all-node-reporter.ts'), join(directory, 'a.test.mjs'), join(directory, 'b.test.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
	context.after(() => { child.kill('SIGKILL'); });
	child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); reader.write(chunk); });
	child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
	const code = await new Promise<number | null>((resolveExit, reject) => { child.once('error', reject); child.once('close', resolveExit); });
	reader.finish();
	assert.equal(code, 1, output);
	const failure = events.findIndex(event => event.type === 'end' && event.failure?.includes('fast failure'));
	const slow = events.find(event => event.type === 'start' && event.label === 'slow first file');
	assert.ok(slow);
	assert.ok(failure >= 0, output);
	assert.ok(failure < events.findIndex(event => event.type === 'end' && event.id === slow.id), output);
	assert.doesNotMatch(output, /✔|✖|# pass|# fail/u);
});

test('browser reporter identifies running tests, reports each failed retry and omits expected failures', context => {
	const output: string[] = [];
	context.mock.method(process.stdout, 'write', (chunk: string) => { output.push(chunk); return true; });
	const reporter = new CheckAllBrowserReporter();
	const testCase = { id: 'export', expectedStatus: 'passed', titlePath: () => ['chromium', 'export'] } as TestCase;
	const result = { status: 'failed', retry: 0, errors: [{ message: 'bad export' }] } as TestResult;
	reporter.onTestBegin(testCase, result);
	reporter.onTestEnd(testCase, result);
	reporter.onTestEnd({ ...testCase, expectedStatus: 'failed' } as TestCase, result);
	reporter.onError({ message: 'browser crashed' });
	const events: CheckProgress[] = [];
	const reader = createCheckOutputReader(event => events.push(event));
	for (const line of output) reader.write(line);
	reader.finish();
	assert.deepEqual(events, [
		{ type: 'start', id: 'export', label: 'chromium > export' },
		{ type: 'end', id: 'export', failure: 'chromium > export\nbad export' },
		{ type: 'end', id: 'export' },
		{ type: 'end', id: 'runner', failure: 'browser crashed' },
	]);
});
