/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { analyzeModuleBrowserCollection, moduleBrowserListArguments, runModuleBrowserTests } from '../scripts/run-module-browser-tests.ts';
import { currentModuleSourceFingerprint } from '../scripts/lib/check-module-repository.ts';

function fixture(mode: 'focused' | 'full' = 'focused', browserTests = ['tests/browser/image.spec.js']) {
	const root = mkdtempSync(join(tmpdir(), 'module-browser-execution-'));
	for (const directory of ['config', 'tests/browser', 'node_modules/@playwright/test']) mkdirSync(join(root, directory), { recursive: true });
	execFileSync('git', ['init', '--quiet', root]);
	execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '--quiet', '-m', 'Fixture']);
	writeFileSync(join(root, '.gitignore'), 'node_modules/\nplan.json\ncalls.jsonl\ncoverage/\n');
	writeFileSync(join(root, 'config/module-policy.json'), JSON.stringify({ schemaVersion: 1, modules: [{ id: 'imaging', sourcePrefixes: ['src/common/imaging/'] }], globalInputs: [] }));
	writeFileSync(join(root, 'tests/browser/image.spec.js'), '');
	const revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
	writeFileSync(join(root, 'plan.json'), JSON.stringify({ schemaVersion: 1, revision, comparisonRevision: null,
		sourceFingerprint: currentModuleSourceFingerprint(root), mode, modules: ['imaging'], nodeTests: [], browserTests, products: ['framescaper'], reasons: [] }));
	writeFileSync(join(root, 'node_modules/@playwright/test/cli.js'), `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync('calls.jsonl', JSON.stringify(args) + '\\n');
if (args.includes('--list')) {
	if (process.env.FIXTURE_COLLECTION === 'failure') process.exit(2);
	if (process.env.FIXTURE_COLLECTION === 'invalid') { console.log('invalid JSON'); process.exit(0); }
	const empty = process.env.FIXTURE_COLLECTION === 'empty-all' || (process.env.FIXTURE_COLLECTION === 'empty-shard' && args.some(arg => arg.startsWith('--shard')));
	console.log(process.env.FIXTURE_REPORT || JSON.stringify({ config: { rootDir: path.resolve('tests/browser') }, suites: empty ? [] : [{ specs: [{ file: 'image.spec.js', tests: [{}] }] }] }));
} else { fs.writeFileSync('scope.json', process.env.SCAPE_BROWSER_SUITE_FILES || 'null'); process.exit(Number(process.env.FIXTURE_EXIT || 0)); }
`);
	return {
		root,
		env: { ...process.env, SCAPE_MODULE_PLAN: 'plan.json' },
		calls: () => readFileSync(join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]),
		close: () => rmSync(root, { recursive: true, force: true }),
	};
}

void test('browser collection counts cases and rejects reported errors or malformed reports', () => {
	const result = analyzeModuleBrowserCollection({ config: { rootDir: '/repo/tests/browser' }, suites: [{ specs: [{ file: 'image.spec.js', tests: [{}, {}] }] }] });
	assert.equal(result.testCount, 2);
	assert.deepEqual(result.files, ['/repo/tests/browser/image.spec.js']);
	assert.throws(() => analyzeModuleBrowserCollection({ errors: [{ message: 'bad spec' }] }), /collection failed/u);
	assert.throws(() => analyzeModuleBrowserCollection({ config: { rootDir: '/repo' }, suites: 'invalid' }), /suites/u);
});

void test('collection arguments preserve project selection and remove only shard or reporter switches', () => {
	const args = ['--project=webkit', '--shard', '2/4', '--reporter=html', '--workers=1'];
	assert.deepEqual(moduleBrowserListArguments(args, true), ['test', '--project=webkit', '--workers=1', '--list', '--reporter=json']);
	assert.deepEqual(moduleBrowserListArguments(args, false), ['test', '--project=webkit', '--shard', '2/4', '--workers=1', '--list', '--reporter=json']);
});

void test('ordinary and full-plan browser runs preserve the exact Playwright arguments', () => {
	for (const plan of [undefined, 'plan.json']) {
		const setup = fixture('full');
		try {
			const args = ['--project=chromium', '--shard=1/4'];
			assert.equal(runModuleBrowserTests(setup.root, args, { ...setup.env, SCAPE_MODULE_PLAN: plan, FIXTURE_EXIT: '7' }), 7);
			assert.deepEqual(setup.calls(), [['test', ...args]]);
		} finally { setup.close(); }
	}
});

void test('suite scheduling selects exact collected files without forwarding native sharding', () => {
	const setup = fixture('full');
	try {
		assert.equal(runModuleBrowserTests(setup.root, ['--project=chromium', '--suite-shard=1/4'], setup.env), 0);
		const calls = setup.calls();
		assert.equal(calls.length, 2);
		assert.ok(calls[0]?.includes('--list'));
		assert.deepEqual(calls[1], ['test', '--project=chromium']);
		assert.deepEqual(JSON.parse(readFileSync(join(setup.root, 'scope.json'), 'utf8')), ['tests/browser/image.spec.js']);
	} finally { setup.close(); }
});

void test('suite prerequisite listing filters the first collection without starting Playwright again', context => {
	const setup = fixture('full');
	let output = '';
	context.mock.method(process.stdout, 'write', (value: string) => { output += value; return true; });
	try {
		const files = ['image.spec.js', 'other-1.spec.js', 'other-2.spec.js', 'other-3.spec.js', 'other-4.spec.js'];
		for (const file of files) writeFileSync(join(setup.root, 'tests/browser', file), '');
		const planFile = join(setup.root, 'plan.json');
		writeFileSync(planFile, JSON.stringify({ ...JSON.parse(readFileSync(planFile, 'utf8')) as Record<string, unknown>,
			sourceFingerprint: currentModuleSourceFingerprint(setup.root) }));
		const report = { config: { rootDir: join(setup.root, 'tests/browser') }, errors: [], stats: { duration: 123 }, suites: [
			{ title: 'nested', suites: files.map(file => ({ file, specs: [{ file, title: file, tests: [{ projectName: 'webkit' }] }] })) },
			{ title: 'empty', specs: [{ file: 'unselected.spec.js', tests: [] }] },
		] };
		assert.equal(runModuleBrowserTests(setup.root, ['--project=webkit', '--suite-shard=1/4', '--list', '--reporter=json'],
			{ ...setup.env, FIXTURE_REPORT: JSON.stringify(report) }), 0);
		assert.equal(setup.calls().length, 1, 'prerequisite discovery must collect the project only once');
		const selected = JSON.parse(output) as typeof report;
		assert.deepEqual(analyzeModuleBrowserCollection(selected).files, files.slice(0, 4).map(file => join(setup.root, 'tests/browser', file)));
		assert.deepEqual(selected.config, report.config);
		assert.deepEqual(selected.stats, report.stats);
		assert.deepEqual(selected.errors, []);
		assert.deepEqual(selected.suites, [{ ...report.suites[0], suites: report.suites[0]!.suites!.slice(0, 4) }]);
	} finally { setup.close(); }
});

void test('focused browser runs collect the full selection and requested shard before executing', () => {
	const setup = fixture();
	try {
		const args = ['--project=chromium', '--shard=1/4'];
		assert.equal(runModuleBrowserTests(setup.root, args, setup.env), 0);
		const calls = setup.calls();
		assert.equal(calls.length, 3);
		assert.ok(!calls[0]?.includes('--shard=1/4'));
		assert.ok(calls[1]?.includes('--shard=1/4'));
		assert.deepEqual(calls[2], ['test', ...args]);
	} finally { setup.close(); }
});

void test('an intentionally empty browser shard emits usable empty coverage without running tests', () => {
	const setup = fixture();
	try {
		assert.equal(runModuleBrowserTests(setup.root, ['--project=chromium', '--shard=4/4'], { ...setup.env, FIXTURE_COLLECTION: 'empty-shard', SCAPE_BROWSER_COVERAGE: '1' }), 0);
		assert.equal(setup.calls().length, 2);
		assert.deepEqual(JSON.parse(readFileSync(join(setup.root, 'coverage/v8-browser/empty-module-selection.json'), 'utf8')), { result: [] });
	} finally { setup.close(); }
});

void test('a plan with no browser workflows skips collection and execution intentionally', () => {
	const setup = fixture('focused', []);
	try {
		assert.equal(runModuleBrowserTests(setup.root, [], setup.env), 0);
		assert.throws(() => setup.calls(), /ENOENT/u);
	} finally { setup.close(); }
});

void test('listing an empty focused browser selection returns a machine-readable empty collection', context => {
	const setup = fixture('focused', []);
	let output = '';
	context.mock.method(process.stdout, 'write', (value: string) => { output += value; return true; });
	try {
		for (const args of [['--suite-shard=1/4', '--list', '--reporter=json'], ['--list', '--reporter=json']]) {
			output = '';
			assert.equal(runModuleBrowserTests(setup.root, args, setup.env), 0);
			assert.equal(analyzeModuleBrowserCollection(JSON.parse(output)).testCount, 0);
		}
		assert.throws(() => setup.calls(), /ENOENT/u);
	} finally { setup.close(); }
});

void test('collection failure and a nonempty plan that matches no browser cases fail closed', () => {
	for (const outcome of ['failure', 'invalid', 'empty-all']) {
		const setup = fixture();
		try {
			assert.throws(() => runModuleBrowserTests(setup.root, ['--project=webkit', '--shard=2/4'], { ...setup.env, FIXTURE_COLLECTION: outcome }), /collection|selected browser/u);
			assert.equal(setup.calls().length, 1);
		} finally { setup.close(); }
	}
});

void test('browser execution rejects missing selected paths before any Playwright process', () => {
	const setup = fixture('focused', ['tests/browser/missing.spec.js']);
	try {
		assert.throws(() => runModuleBrowserTests(setup.root, [], setup.env), /missing test path/u);
		assert.throws(() => setup.calls(), /ENOENT/u);
	} finally { setup.close(); }
});

void test('every selected spec must appear in unsharded collection before a shard may skip', () => {
	const setup = fixture('focused', ['tests/browser/image.spec.js', 'tests/browser/other.spec.js']);
	try {
		writeFileSync(join(setup.root, 'tests/browser/other.spec.js'), '');
		const planFile = join(setup.root, 'plan.json');
		writeFileSync(planFile, JSON.stringify({ ...JSON.parse(readFileSync(planFile, 'utf8')) as Record<string, unknown>,
			sourceFingerprint: currentModuleSourceFingerprint(setup.root) }));
		assert.throws(() => runModuleBrowserTests(setup.root, ['--project=chromium', '--shard=4/4'], { ...setup.env, FIXTURE_COLLECTION: 'empty-shard' }), /other\.spec\.js/u);
		assert.equal(setup.calls().length, 1);
	} finally { setup.close(); }
});
