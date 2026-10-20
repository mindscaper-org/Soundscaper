/* SPDX-License-Identifier: AGPL-3.0-only */
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { photoNativeRecordCurrentV1 as record, photoNativeRelativeCurrentV1 as path, photoNativeTargetCurrentV1 as target } from '../../src/lightscaper/desktop-photo-native-artifacts-current-v1.ts';
import { lightscaperRawNativeTestRecipeCurrentV1 as rawRecipe } from './lightscaper-raw-native-test-recipe-current-v1.ts';
import type { NativeTestFixtureRecipe } from './node-native-test-fixture-recipes.ts';
export const PHOTO_NATIVE_FIXTURE_RESULT_CURRENT_V1 = 'lightscaper-photo-native-build/result/build-result.json';
/** The canonical suite prepares the SAME shipping producer once, before test
 * workers start. This is a complete result bundle, not a second executable loader. */
export function lightscaperPhotoNativeTestRecipeCurrentV1(repositoryRoot: string, environment: NodeJS.ProcessEnv): NativeTestFixtureRecipe {
 const raw = rawRecipe(repositoryRoot, environment), manifest = join(repositoryRoot, 'native/lightscaper-photo-native-current-v1/source-manifest.json');
 const metadata = lstatSync(manifest); if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 2 * 1024 * 1024) throw new Error('Photo fixture source plan is not a bounded real file.');
 const plan = record(JSON.parse(readFileSync(manifest, 'utf8')) as unknown, ['schemaVersion', 'id', 'targets', 'files']);
 if (plan.schemaVersion !== 1 || plan.id !== 'lightscaper-photo-native-current-v1' || !Array.isArray(plan.files) || plan.files.length < 20 || plan.files.length > 128) throw new Error('Photo fixture source plan identity differs.');
 const platform = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : process.platform;
 const actual = target(`${platform}-${process.arch}`), names = plan.files.map(path);
 if (new Set(names).size !== names.length) throw new Error('Photo fixture source plan is duplicate.');
 return Object.freeze({ kind: 'lightscaper-photo-native', compiler: 'cmake', arguments: Object.freeze([]), sources: Object.freeze([...new Set([...names.map(name => join(repositoryRoot, name)), ...raw.sources])]),
  headerRoots: raw.headerRoots, photoNative: Object.freeze({ repositoryRoot, target: actual, librawSourceRoot: environment.LIGHTSCAPER_LIBRAW_SOURCE_ROOT! }) });
}
