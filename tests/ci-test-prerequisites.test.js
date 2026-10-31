/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { interchangeRequiredForTests, selectedBrowserTestFiles } from '../scripts/ci-test-prerequisites.mjs';

function fixture(context) {
	const root = mkdtempSync(join(tmpdir(), 'soundscaper-prerequisite-selection-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	for (const [file, source] of [
		['tests/browser/reader.spec.js', "import '../helpers/nested-reader.ts';"],
		['tests/browser/ordinary.spec.js', "import '../../src/ordinary.ts';"],
		['tests/helpers/nested-reader.ts', "export { read } from './interchange-reference.ts';"],
		['tests/helpers/interchange-reference.ts', 'export const read = true;'],
		['tests/audio-editor-dawproject-reference-conformance.test.ts', 'export const validatesPublishedSchemas = true;'],
		['src/ordinary.ts', 'export const ordinary = true;'],
	]) {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		writeFileSync(join(root, file), source);
	}
	return root;
}

test('selected dependency closures require interchange readers only on their actual consuming selection', context => {
	const root = fixture(context);
	assert.equal(interchangeRequiredForTests(root, [join(root, 'tests/browser/ordinary.spec.js')]), false);
	assert.equal(interchangeRequiredForTests(root, [join(root, 'tests/browser/reader.spec.js')]), true);
	assert.equal(interchangeRequiredForTests(root, [join(root, 'tests/audio-editor-dawproject-reference-conformance.test.ts')]), true);
	assert.equal(interchangeRequiredForTests(root, []), false);
});

test('Playwright prerequisite discovery uses only selected specs, including nested suites', context => {
	const root = fixture(context);
	const report = { config: { rootDir: join(root, 'tests/browser') }, errors: [], suites: [
		{ file: 'ordinary.spec.js', specs: [{ file: 'ordinary.spec.js', tests: [{ projectName: 'chromium' }] }] },
		{ file: 'reader.spec.js', specs: [], suites: [{ specs: [{ file: 'reader.spec.js', tests: [{ projectName: 'chromium' }] }] }] },
		{ file: 'unselected.spec.js', specs: [{ file: 'unselected.spec.js', tests: [] }] },
	] };
	assert.deepEqual(selectedBrowserTestFiles(report), ['ordinary.spec.js', 'reader.spec.js'].map(file => join(root, 'tests/browser', file)));
	assert.throws(() => selectedBrowserTestFiles({ ...report, errors: [{ message: 'reader collection failed' }] }), /collection failed/u);
});

test('production parity discovery needs no downloaded build assets in any browser project', context => {
	const root = fileURLToPath(new URL('../', import.meta.url));
	const spec = 'tests/browser/audio-editor-m4-production-parity.spec.js';
	const result = spawnSync(process.execPath, [
		join(root, 'node_modules/@playwright/test/cli.js'), 'test', spec, '--list', '--reporter=json',
		'--project=chromium', '--project=firefox', '--project=webkit',
	], {
		cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 ** 2,
		env: { ...process.env, SCAPE_BROWSER_PRODUCTS_PREPARED: '1',
			SCAPE_BROWSER_PRODUCT_FIXTURE_ROOT: fixture(context), SOUNDSCAPER_M4_PRODUCTION_PARITY: '1' },
	});
	assert.ifError(result.error);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	const report = JSON.parse(result.stdout);
	assert.deepEqual(selectedBrowserTestFiles(report), [join(root, spec)]);
	const projects = report.suites.flatMap(suite => suite.specs.flatMap(spec => spec.tests.map(test => test.projectName)));
	assert.deepEqual(projects.sort(), ['chromium', 'firefox', 'webkit']);
});
