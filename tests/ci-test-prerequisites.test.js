/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
