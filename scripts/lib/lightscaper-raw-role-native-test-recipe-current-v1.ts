/* SPDX-License-Identifier: AGPL-3.0-only */
import { join } from 'node:path';
import type { NativeTestFixtureRecipe } from './node-native-test-fixture-recipes.ts';
import { lightscaperRawNativeTestRecipeCurrentV1 } from './lightscaper-raw-native-test-recipe-current-v1.ts';

/** Same authenticated extraction and one existing fresh-artifact registry;
 * actual SRR1 entrypoint replaces the one-shot engine test fixture only. */
export function lightscaperRawRoleNativeTestRecipeCurrentV1(repositoryRoot: string, environment: NodeJS.ProcessEnv): Omit<NativeTestFixtureRecipe, 'kind'> & Readonly<{ kind: 'lightscaper-raw-role' }> {
 const engine = lightscaperRawNativeTestRecipeCurrentV1(repositoryRoot, environment);
 const fixture = join(repositoryRoot, 'native/lightscaper-raw-engine-current-v1/tests/engine_fixture.cpp');
 if (!engine.cmake || engine.sources.filter(source => source === fixture).length !== 1) throw new Error('Native RAW source recipe no longer has its exact private fixture.');
 return Object.freeze({ ...engine, kind: 'lightscaper-raw-role',
  cmake: Object.freeze({ ...engine.cmake, target: 'lightscaper_photo_raw_current_v1',
   definitions: Object.freeze([...engine.cmake.definitions, '-DLIGHTSCAPER_BUILD_RAW_ENGINE_FIXTURE=OFF']) }),
  sources: Object.freeze([...engine.sources.filter(source => source !== fixture),
   join(repositoryRoot, 'native/lightscaper-raw-engine-current-v1/src/raw_process.cpp'),
   join(repositoryRoot, 'native/common/sha256.cpp'), join(repositoryRoot, 'native/common/sha256.hpp')]),
  headerRoots: engine.headerRoots,
 });
}
