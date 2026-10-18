/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeTestFixtureRecipes, selectedNativeTestFixtures } from '../scripts/lib/node-native-test-fixture-recipes.ts';

test('Lightscaper native tests select one fresh shared reader and RAW engine artifact', () => {
	assert.deepEqual(selectedNativeTestFixtures([
		'tests/lightscaper-native-granted-file-reader-current.test.ts',
		'tests/lightscaper-native-raw-engine-current.test.ts',
		'tests/lightscaper-native-raw-engine-current.test.ts',
	], {}, false), ['lightscaper-granted-file-reader', 'lightscaper-raw-engine']);
});

test('unrelated native fixture recipes do not require a LibRaw extraction', () => {
	assert.equal(nativeTestFixtureRecipes('/unused', {})['media-contract'].kind, 'media-contract');
	assert.deepEqual(selectedNativeTestFixtures(['tests/lightscaper-develop-state.test.ts'], {}, false), []);
});
