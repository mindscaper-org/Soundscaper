/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createCheckAllLog } from '../scripts/lib/check-all-logs.ts';

test('check-all creates logs immediately and writes each chunk before returning', context => {
	const root = mkdtempSync(join(tmpdir(), 'check-all-live-log-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const file = join(root, 'test-results/check-all/logs/node-fixture.log');
	const log = createCheckAllLog(file);
	assert.equal(readFileSync(file, 'utf8'), '');
	log.write('started\n');
	assert.equal(readFileSync(file, 'utf8'), 'started\n');
	const bytes = Buffer.from('failed: café\n');
	const boundary = bytes.indexOf(Buffer.from('é')) + 1;
	log.write(bytes.subarray(0, boundary));
	log.write(bytes.subarray(boundary));
	assert.equal(readFileSync(file, 'utf8'), 'started\nfailed: café\n');
	log.end();
});

test('check-all resumes logging if another runner removes its output directory', context => {
	const root = mkdtempSync(join(tmpdir(), 'check-all-recreated-log-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const file = join(root, 'test-results/check-all/logs/node-fixture.log');
	const log = createCheckAllLog(file);
	log.write('started\n');
	rmSync(join(root, 'test-results'), { recursive: true });
	log.write('failure after cleanup\n');
	assert.equal(readFileSync(file, 'utf8'), 'failure after cleanup\n');
	log.end();
});
