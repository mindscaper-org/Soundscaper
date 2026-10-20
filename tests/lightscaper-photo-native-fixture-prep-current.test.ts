/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { selectedNativeTestFixtures as select, nativeTestFixtureRecipes } from '../scripts/lib/node-native-test-fixture-recipes.ts';
import { lightscaperPhotoNativeTestRecipeCurrentV1 as photoRecipe } from '../scripts/lib/lightscaper-photo-native-test-recipe-current-v1.ts';
import { prepareLightscaperNativeTestSourceCurrentV1 as source } from '../scripts/lib/lightscaper-native-test-source-current-v1.ts';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
void test('canonical selection prepares the full Photo bundle only for actual deployment consumers and preserves historical kinds', { timeout: 15000 }, () => {
 for (const name of ['lightscaper-photo-native-artifacts-current.test.ts', 'lightscaper-photo-native-payload-current.test.ts', 'lightscaper-photo-native-stage-current.test.ts']) assert.deepEqual(select([`tests/${name}`], {}), ['lightscaper-photo-native']);
 assert.deepEqual(select(['tests/lightscaper-native-raw-trusted-retire-current.test.ts'], {}), ['lightscaper-raw-role']);
 assert.deepEqual(select(['tests/lightscaper-photo-native-fixture-prep-current.test.ts'], {}), []);
 assert.equal(Object.keys(nativeTestFixtureRecipes(ROOT, {})).sort().join(','), 'delivery-filesystem,media-contract,media-contract-exact,media-validator');
});
void test('Photo fixture recipe fingerprints the real complete native and authenticated upstream closure without per-case compilation', { timeout: 15000 }, async context => {
 const directory = await mkdtemp(join(tmpdir(), 'lightscaper-photo-fixture-recipe-'));
 try {
  context.signal.throwIfAborted(); const upstream = source(ROOT, directory), recipe = photoRecipe(ROOT, { LIGHTSCAPER_LIBRAW_SOURCE_ROOT: upstream }); context.signal.throwIfAborted();
  assert.equal(recipe.kind, 'lightscaper-photo-native'); assert.equal(recipe.compiler, 'cmake'); assert.ok(recipe.photoNative);
  assert.equal(recipe.photoNative.repositoryRoot, ROOT); assert.equal(recipe.photoNative.librawSourceRoot, upstream);
  for (const name of ['native/lightscaper-photo-native-current-v1/CMakeLists.txt', 'native/lightscaper-photo-native-current-v1/source-manifest.json', 'native/lightscaper-photo-native-current-v1/src/photo_windows_image.hpp', 'native/lightscaper-raw-engine-current-v1/src/raw_process.cpp']) assert.ok(recipe.sources.includes(join(ROOT, name)), name);
  assert.ok(recipe.headerRoots.includes(upstream)); assert.ok(recipe.sources.length >= 70 && recipe.sources.length < 300);
 } finally { await rm(directory, { recursive: true, force: true }); }
});
