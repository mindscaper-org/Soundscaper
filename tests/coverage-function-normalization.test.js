/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeDuplicateFunctionCoverage } from '../scripts/lib/coverage-function-normalization.mjs';

const span = (startColumn, endColumn = 1) => ({
	start: { line: 12, column: startColumn },
	end: { line: 20, column: endColumn },
});

test('combines Node and browser names for the same mapped function', () => {
	const path = '/repo/src/common/transfer/admission.ts';
	const summary = { [path]: { functions: { total: 2, covered: 1, pct: 50 } } };
	const detailed = { [path]: {
		fnMap: {
			0: { name: 's', loc: span(0) },
			1: { name: 'admitTransfer', loc: span(7) },
		},
		f: { 0: 0, 1: 7 },
	} };
	const normalized = normalizeDuplicateFunctionCoverage(summary, detailed);
	assert.deepEqual(normalized[path].functions, { total: 1, covered: 1, pct: 100 });
	assert.deepEqual(summary[path].functions, { total: 2, covered: 1, pct: 50 });
});

test('combines execution from either mapped copy', () => {
	const path = '/repo/src/common/transfer/admission.ts';
	const summary = { [path]: { functions: { total: 2, covered: 2, pct: 100 } } };
	const detailed = { [path]: {
		fnMap: {
			0: { name: 's', loc: span(0) },
			1: { name: 'admitTransfer', loc: span(7) },
		},
		f: { 0: 1, 1: 7 },
	} };
	assert.deepEqual(normalizeDuplicateFunctionCoverage(summary, detailed)[path].functions,
		{ total: 1, covered: 1, pct: 100 });
});

test('keeps different functions that happen to share a line', () => {
	const path = '/repo/src/common/transfer/admission.ts';
	const summary = { [path]: { functions: { total: 2, covered: 1, pct: 50 } } };
	const detailed = { [path]: {
		fnMap: {
			0: { name: 'outer', loc: span(0) },
			1: { name: 'inner', loc: span(7) },
		},
		f: { 0: 1, 1: 0 },
	} };
	assert.deepEqual(normalizeDuplicateFunctionCoverage(summary, detailed), summary);
});

test('combines duplicate class field initializers without dropping their execution', () => {
	const path = '/repo/src/common/transfer/admission.ts';
	const summary = { [path]: { functions: { total: 2, covered: 1, pct: 50 } } };
	const detailed = { [path]: {
		fnMap: {
			0: { name: '<instance_members_initializer>', loc: span(1, 43) },
			1: { name: '<instance_members_initializer>', loc: span(10, 43) },
		},
		f: { 0: 0, 1: 3 },
	} };
	assert.deepEqual(normalizeDuplicateFunctionCoverage(summary, detailed)[path].functions,
		{ total: 1, covered: 1, pct: 100 });
});

test('CommonJS export getters mapped onto a comment do not count as source functions', () => {
	const path = '/repo/src/releases.ts';
	const source = '/* License */\nexport function called() { return 1; }\nexport function uncalled() { return 2; }\n';
	const comment = { start: { line: 1, column: 0 }, end: { line: 1, column: 13 } };
	const called = { start: { line: 2, column: 7 }, end: { line: 2, column: 38 } };
	const uncalled = { start: { line: 3, column: 7 }, end: { line: 3, column: 40 } };
	const summary = { [path]: { functions: { total: 4, covered: 2, pct: 50 } } };
	const detailed = { [path]: {
		fnMap: {
			0: { name: 'called', loc: called },
			1: { name: 'uncalled', loc: uncalled },
			2: { name: 'called', loc: comment },
			3: { name: 'uncalled', loc: comment },
		},
		// Reading an export getter must never stand in for executing its body.
		f: { 0: 1, 1: 0, 2: 0, 3: 1 },
	} };
	assert.deepEqual(normalizeDuplicateFunctionCoverage(summary, detailed, () => source)[path].functions,
		{ total: 2, covered: 1, pct: 50 });
	assert.deepEqual(summary[path].functions, { total: 4, covered: 2, pct: 50 });
});

test('comment-mapped coverage without a matching exported source declaration stays in the gate', () => {
	const path = '/repo/src/releases.ts';
	const comment = { start: { line: 1, column: 0 }, end: { line: 1, column: 13 } };
	const summary = { [path]: { functions: { total: 1, covered: 0, pct: 0 } } };
	const detailed = { [path]: { fnMap: { 0: { name: 'missing', loc: comment } }, f: { 0: 0 } } };
	for (const source of [undefined, '/* License */\nconst missing = 1;\n',
		'/* License */\nexport function missing() {}\n', 'export function missing() {}\n']) {
		assert.deepEqual(normalizeDuplicateFunctionCoverage(summary, detailed, () => source), summary);
	}
});
