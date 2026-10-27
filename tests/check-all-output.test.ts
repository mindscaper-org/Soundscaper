/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { CheckAllDisplay, createCheckOutputReader, progressRecord, type CheckProgress } from '../scripts/lib/check-all-output.ts';

test('check-all decodes split UTF-8 progress records and bounds noisy output', () => {
	const messages: unknown[] = [];
	const reader = createCheckOutputReader(message => messages.push(message));
	const record = Buffer.from(progressRecord({ type: 'start', id: '1', label: 'café' }));
	const boundary = record.indexOf(Buffer.from('é')) + 1;
	reader.write(record.subarray(0, boundary));
	reader.write(record.subarray(boundary));
	reader.write('x'.repeat(100_000));
	reader.write('\nSCAPE_CHECK_ALL {broken}\n');
	reader.write(progressRecord({ type: 'end', id: '1', failure: 'assertion failed' }));
	reader.finish();
	assert.deepEqual(messages, [
		{ type: 'start', id: '1', label: 'café' },
		{ type: 'end', id: '1', failure: 'assertion failed' },
	]);
});

test('check-all keeps successful results quiet and prints failures before work finishes', () => {
	let output = '';
	const display = new CheckAllDisplay({ write: text => { output += text; }, isTTY: false }, 2);
	display.states(new Map([['node', 'running'], ['browser', 'running']]));
	display.event('node', { type: 'start', id: '1', label: 'currently running' });
	display.event('node', { type: 'end', id: '1' });
	assert.equal(output.includes('PASS'), false);
	display.event('browser', { type: 'end', id: '2', failure: 'bad export\nexpected 4, got 3' });
	assert.match(output, /bad export\nexpected 4, got 3/u);
	display.render();
	assert.match(output, /\[[-#]+\].*0\/2/u);
	display.finish();
});

test('check-all keeps error diagnostics distinct from failed test results', () => {
	let output = '';
	const display = new CheckAllDisplay({ write: text => { output += text; } }, 1);
	display.diagnostic('node/soundscaper', 'Error: PCM read failed after priming');
	display.diagnostic('node/common-1', 'Module.instantiateWasm callback failed with error: fixture error');
	display.event('node/soundscaper', { type: 'end', id: 'passing-error-path' });
	assert.match(output, /^node\/soundscaper: Error: PCM read failed after priming$/mu);
	assert.match(output, /^node\/common-1: Module\.instantiateWasm callback failed with error: fixture error$/mu);
	assert.doesNotMatch(output, /^FAIL /mu);
	display.event('node/soundscaper', { type: 'end', id: 'broken-test', failure: 'expected 4, got 3' });
	assert.match(output, /^FAIL node\/soundscaper: expected 4, got 3$/mu);
});

test('check-all keeps large assertion diffs readable within its bounded progress protocol', () => {
	const messages: CheckProgress[] = [];
	const reader = createCheckOutputReader(message => messages.push(message));
	const encoded = progressRecord({ type: 'end', id: 'assertion', failure: 'failure\n' + '\u0000'.repeat(100_000) });
	assert.ok(encoded.length < 65_536);
	reader.write(encoded);
	reader.finish();
	assert.equal(messages.length, 1);
	assert.ok(messages[0].type === 'end' && messages[0].failure?.includes('diagnostic truncated'));
});

test('check-all terminal progress replaces running names without erasing failure messages', () => {
	let output = '';
	const display = new CheckAllDisplay({ write: text => { output += text; }, isTTY: true, columns: 90 }, 1);
	display.states(new Map([['node', 'running']]));
	display.event('node', { type: 'start', id: '1', label: 'running test\u001b[2J' });
	display.render();
	assert.match(output, /running test/u);
	assert.equal(output.includes('\u001b[2J'), false);
	display.event('node', { type: 'end', id: '1', failure: 'broken test' });
	display.states(new Map([['node', 'failed']]));
	display.finish();
	assert.match(output, /broken test/u);
	assert.match(output, /1\/1/u);
});
