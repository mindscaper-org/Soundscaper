/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { decodeWebVttLabelText } from '../src/common/editor/label-cue-text.ts';
import { parseTimeText } from '../vendor/audacity-design-system/components/src/TimeCode/time-code-text.ts';

test('WebVTT strips supported tags and classes while preserving literal and unknown markup', () => {
	assert.equal(decodeWebVttLabelText('<c.one.two>one</c> <v Alice>two</v> <00:01.000>three'), 'one two three');
	assert.equal(decodeWebVttLabelText('&lt;b&gt;literal&lt;/b&gt; <unknown>x</unknown>'), '<b>literal</b> <unknown>x</unknown>');
	assert.equal(decodeWebVttLabelText('<b.!.!.!'), '<b.!.!.!');
});

test('time entry preserves decimal, unit, colon and sample semantics', () => {
	for (const [value, seconds] of [['+1.', 1], ['.5', 0.5], ['1.d2.h3.m4.s', 93784], ['1:2:3:4.5', 93784.5]] as const) {
		assert.equal(parseTimeText(value, 'hh:mm:ss'), seconds);
	}
	for (const value of ['1..0', '1m2h', '1::2', '+1:02', '1:2:3:4:5', '1s!']) {
		assert.equal(parseTimeText(value, 'hh:mm:ss'), null);
	}
});

test('WebVTT imports finish for adversarial cue classes within the ordinary input limits', () => {
	assertFinishes(`
		import assert from 'node:assert/strict';
		import { parseWebVttLabels } from './src/common/editor/label-io.js';
		const title = '<b.' + '!.'.repeat(10_000) + '!';
		const result = parseWebVttLabels('WEBVTT\\n\\n00:00:00.000 --> 00:00:01.000\\n' + title);
		assert.equal(result.labels[0].title, title);
	`);
});

test('time entry rejects long invalid numbers, units and colon fields without backtracking', () => {
	assertFinishes(`
		import assert from 'node:assert/strict';
		import { parseTimeText } from './vendor/audacity-design-system/components/src/TimeCode/time-code-text.ts';
		for (const value of ['0'.repeat(100_000) + '!', '0'.repeat(100_000) + 'd!', '1:' + '0'.repeat(100_000) + '!']) {
			assert.equal(parseTimeText(value, 'hh:mm:ss'), null);
		}
	`);
});

function assertFinishes(source: string): void {
	const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', source], {
		cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', timeout: 5_000,
	});
	assert.equal(result.status, 0, result.error?.message ?? result.stderr);
}
