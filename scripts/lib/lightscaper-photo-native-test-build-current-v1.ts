/* SPDX-License-Identifier: AGPL-3.0-only */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import type { NativeTestFixtureRecipe } from './node-native-test-fixture-recipes.ts';
/** One real producer invocation in shared preparation. No test case builds.
 * Synchronous child completion includes actual stdout/stderr closure; the Root
 * runner owns the enclosing build process tree and forced deadline cleanup. */
export function buildLightscaperPhotoNativeTestCurrentV1(recipe: NativeTestFixtureRecipe, outputPath: string): void {
 const selected = recipe.photoNative; if (!selected) throw new Error('Photo native bundle recipe is absent.');
 const buildRoot = dirname(dirname(outputPath));
 const result = spawnSync(process.execPath, [join(selected.repositoryRoot, 'scripts/build-lightscaper-photo-native-current-v1.mjs'), `--root=${selected.repositoryRoot}`, `--target=${selected.target}`,
  `--libraw-source=${selected.librawSourceRoot}`, `--build-root=${buildRoot}`, '--working-tree'], { cwd: selected.repositoryRoot, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true });
 if (result.error || result.signal || result.status !== 0) throw new Error(`Actual Photo fixture producer failed: ${String(result.error ?? result.signal ?? '')}\n${String(result.stderr || result.stdout || '').slice(-8192)}`);
}
