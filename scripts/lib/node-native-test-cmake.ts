/* SPDX-License-Identifier: AGPL-3.0-only */
import { spawnSync } from 'node:child_process';
import { constants, copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { NativeTestFixtureRecipe } from './node-native-test-fixture-recipes.ts';

/** One fresh configure/build per prepared artifact. CMake selects the actual
 * maintained host toolchain, including MSVC; cases only copy its executable. */
export function buildNativeTestCmakeFixture(recipe: NativeTestFixtureRecipe, outputPath: string): void {
	const cmake = recipe.cmake;
	if (!cmake) throw new Error('Native CMake fixture recipe is absent.');
	const buildRoot = join(dirname(outputPath), `.build-${recipe.kind}`);
	mkdirSync(buildRoot);
	const invoke = (arguments_: readonly string[]): void => {
		const result = spawnSync(recipe.compiler, [...arguments_], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
		if (result.error || result.signal || result.status !== 0) throw new Error(`Native fixture ${recipe.kind} CMake failed: ${String(result.error ?? result.signal ?? '')}\n${String(result.stderr ?? result.stdout ?? '').slice(-8192)}`);
	};
	try {
		invoke(['-S', cmake.sourceRoot, '-B', buildRoot, '-DCMAKE_BUILD_TYPE=Release', ...cmake.definitions]);
		invoke(['--build', buildRoot, '--config', 'Release', '--parallel', '1', '--target', cmake.target]);
		const name = cmake.target + (process.platform === 'win32' ? '.exe' : '');
		try { copyFileSync(join(buildRoot, name), outputPath, constants.COPYFILE_EXCL); }
		catch (error) {
			if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
			copyFileSync(join(buildRoot, 'Release', name), outputPath, constants.COPYFILE_EXCL);
		}
	} finally { rmSync(buildRoot, { recursive: true, force: true }); }
}
