/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertModuleCIResults } from '../scripts/check-module-ci-results.mjs';

test('Quality aggregate rejects failed, skipped, cancelled, and missing prerequisites', () => {
	const completed = Object.fromEntries(['build', 'tests', 'native-platform-compile', 'browser', 'firefox', 'browser-lightscaper-gpu', 'lint', 'typecheck', 'audits'].map(id => [id, { result: 'success' }]));
	assert.doesNotThrow(() => assertModuleCIResults(completed));
	for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
		assert.throws(() => assertModuleCIResults({ ...completed, browser: { result } }), /browser/u);
	}
	assert.throws(() => assertModuleCIResults({}), /requires/u);
	for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
		assert.throws(() => assertModuleCIResults({ ...completed, 'browser-lightscaper-gpu': { result } }), /browser-lightscaper-gpu/u);
	}
	const { firefox: _firefox, ...missing } = completed;
	assert.throws(() => assertModuleCIResults(missing), /firefox/u);
});
