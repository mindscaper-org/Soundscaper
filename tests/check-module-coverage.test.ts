/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { analyzeModuleCoverage, productionModuleCoverageTargets, runModuleCoverageGate } from '../scripts/lib/check-module-coverage.ts';
import { parseModulePolicy } from '../scripts/lib/module-policy.ts';

const root = '/repository';
const first = 'src/common/imaging/first.ts';
const second = 'src/common/imaging/second.ts';
const core = 'src/common/editor/engine/core.ts';
const policy = parseModulePolicy({ schemaVersion: 1, modules: [
	{ id: 'imaging', sourcePrefixes: ['src/common/imaging/'], coverageScope: 'editor' },
	{ id: 'editor', sourcePrefixes: ['src/common/editor/'] },
] });

test('test-only module suites retain structural checks without inventing shipped-code cohorts', () => {
	const mixed = parseModulePolicy({ schemaVersion: 1, modules: [...policy.modules,
		{ id: 'tooling', sourcePrefixes: ['scripts/'] }, { id: 'handbook', sourcePrefixes: ['handbook/'] }] });
	assert.deepEqual(productionModuleCoverageTargets(mixed, ['imaging', 'tooling', 'handbook']), ['imaging']);
	assert.throws(() => productionModuleCoverageTargets(mixed, ['missing']), /Unknown module/u);
});

function coverage(covered: number, total = 100): Record<string, unknown> {
	return Object.fromEntries(['lines', 'branches', 'functions'].map(metric => [metric, { covered, total }]));
}

test('module coverage counts its complete owned inventory at inherited floors', () => {
	const result = analyzeModuleCoverage({ [first]: coverage(100), [second]: coverage(96) }, root, policy,
		['imaging'], [first, second, core]);
	assert.deepEqual(result.failures, []);
	assert.equal(result.scopes.length, 1);
	assert.equal(result.scopes[0]?.moduleId, 'imaging');
	assert.equal(result.scopes[0]?.scopeId, 'editor');
	assert.deepEqual(result.scopes[0]?.metrics.lines, { covered: 196, total: 200, percentage: 98 });
});

test('an unreported owned file cannot disappear from the denominator', () => {
	const result = analyzeModuleCoverage({ [first]: coverage(100) }, root, policy, ['imaging'], [first, second]);
	assert.ok(result.failures.some(failure => failure.includes(`missing coverage for ${second}`)));
	assert.equal(result.scopes[0]?.files.length, 2);
});

test('each module and inherited scope keeps its own floor rather than averaging into consumers', () => {
	const result = analyzeModuleCoverage({ [first]: coverage(97), [core]: coverage(100) }, root, policy,
		['imaging', 'editor'], [first, core]);
	assert.ok(result.failures.some(failure => /imaging.*lines.*97.*98/u.test(failure)));
	assert.equal(result.scopes.length, 2);
	assert.equal(result.scopes.find(scope => scope.moduleId === 'editor')?.scopeId, 'editor-core');
});

test('module coverage rejects unknown targets, empty inventories, and invalid metric counts', () => {
	assert.throws(() => analyzeModuleCoverage({}, root, policy, ['missing'], [first]), /Unknown module/u);
	assert.throws(() => analyzeModuleCoverage({}, root, policy, [], [first]), /at least one/u);
	assert.ok(analyzeModuleCoverage({}, root, policy, ['imaging'], []).failures.some(failure => /no production source/u.test(failure)));
	assert.throws(() => analyzeModuleCoverage({ [first]: coverage(101) }, root, policy, ['imaging'], [first]), /invalid.*count/u);
	assert.throws(() => analyzeModuleCoverage({ [first]: {} }, root, policy, ['imaging'], [first]), /invalid.*count/u);
});

test('module coverage refuses unexpected sources and duplicate normalized file identities', () => {
	const unexpected = analyzeModuleCoverage({ [first]: coverage(100), [core]: coverage(100) }, root, policy, ['imaging'], [first]);
	assert.ok(unexpected.failures.some(failure => failure.includes(`unexpected source ${core}`)));
	assert.throws(() => analyzeModuleCoverage({ [first]: coverage(100), [`${root}/${first}`]: coverage(100) },
		root, policy, ['imaging'], [first]), /duplicate source/u);
});

test('module scope configuration cannot refer to a missing coverage budget', () => {
	const invalid = parseModulePolicy({ schemaVersion: 1, modules: [
		{ id: 'imaging', sourcePrefixes: ['src/common/imaging/'], coverageScope: 'no-floor' },
	] });
	assert.throws(() => analyzeModuleCoverage({ [first]: coverage(100) }, root, invalid, ['imaging'], [first]), /coverage budget/u);
});

test('module coverage requires usable V8 evidence before invoking a report', () => {
	const directory = mkdtempSync(join(tmpdir(), 'scape-module-coverage-empty-'));
	try {
		assert.throws(() => runModuleCoverageGate(directory, join(directory, 'missing'), ['imaging'], policy), /coverage.*missing/u);
		const raw = join(directory, 'raw');
		mkdirSync(raw);
		assert.throws(() => runModuleCoverageGate(directory, raw, ['imaging'], policy), /coverage.*empty/u);
		writeFileSync(join(raw, 'empty.json'), JSON.stringify({ result: [] }));
		assert.throws(() => runModuleCoverageGate(directory, raw, ['imaging'], policy), /usable V8/u);
	} finally { rmSync(directory, { recursive: true, force: true }); }
});

test('c8 includes an owned file that no selected test loaded', () => {
	const fixture = mkdtempSync(join(tmpdir(), 'scape-module-coverage-all-'));
	const repository = fileURLToPath(new URL('..', import.meta.url));
	try {
		const loaded = 'src/common/imaging/loaded.js';
		const unexecuted = 'src/common/imaging/unexecuted.js';
		mkdirSync(dirname(join(fixture, loaded)), { recursive: true });
		mkdirSync(join(fixture, 'config'));
		copyFileSync(join(repository, 'config/coverage-gates.json'), join(fixture, 'config/coverage-gates.json'));
		writeFileSync(join(fixture, '.c8rc.json'), JSON.stringify({ extension: ['.js'], exclude: [] }));
		writeFileSync(join(fixture, loaded), 'export function used() { return 1; }\nused();\n');
		writeFileSync(join(fixture, unexecuted), 'export function neverLoaded() { return 2; }\nneverLoaded();\n');
		symlinkSync(resolve(repository, 'node_modules'), join(fixture, 'node_modules'), 'junction');
		const git = spawnSync('git', ['init', '--quiet'], { cwd: fixture });
		assert.equal(git.status, 0);
		const raw = join(fixture, 'raw');
		mkdirSync(raw);
		const capture = spawnSync(process.execPath, [join(fixture, loaded)], {
			cwd: fixture, env: { ...process.env, NODE_V8_COVERAGE: raw }, encoding: 'utf8',
		});
		assert.equal(capture.status, 0, capture.stderr);
		assert.equal(runModuleCoverageGate(fixture, raw, ['imaging'], policy), false,
			'unexecuted source must lower coverage rather than vanish from the module report');
	} finally { rmSync(fixture, { recursive: true, force: true }); }
});
