/* SPDX-License-Identifier: AGPL-3.0-only */
import { posix, win32 } from 'node:path';
import { FRAMESCAPER_FFMPEG_POLICY } from '../../native/framescaper-media-host/build/media-build-commands.mjs';
import type { MotionNativeTarget } from './motionscaper-native-source.ts';
import { motionReferenceDecoderName } from './motionscaper-reference-target.ts';

export interface MotionReferenceTools { readonly cmake: string; readonly ninja: string; readonly c: string; readonly cxx: string; readonly pkgConfig: string; readonly rc?: string }
export interface MotionReferenceCompileInput {
	readonly target: MotionNativeTarget; readonly repositoryRoot: string; readonly directory: string;
	readonly installRoots: readonly string[]; readonly tools: MotionReferenceTools;
}
export interface MotionReferenceCompileCommand { readonly phase: 'configure' | 'compile'; readonly executable: string; readonly args: readonly string[]; readonly cwd: string }

/** A declarative argv plan only. The executing owner separately requires the actual native host. */
export function createMotionReferenceCompilePlan(input: MotionReferenceCompileInput) {
	const path = input.target.startsWith('win-') ? win32 : posix;
	const canonical = (value: string): string => {
		if (!path.isAbsolute(value) || path.resolve(value) !== value || /[\0\r\n;]/u.test(value)) throw new Error('Reference compiler path must be absolute and normalized.');
		return value;
	};
	canonical(input.repositoryRoot); canonical(input.directory);
	for (const role of ['cmake', 'ninja', 'c', 'cxx', 'pkgConfig'] as const) canonical(input.tools[role]);
	if (input.target.startsWith('win-') && !input.tools.rc) throw new Error('Reference Windows compiler plan requires its authenticated resource compiler.');
	if (input.tools.rc) canonical(input.tools.rc);
	requireMotionReferenceInstallRoots(input.installRoots, input.target);
	const decoder = path.join(input.directory, motionReferenceDecoderName(input.target));
	const build = path.join(input.directory, 'reference-build');
	const configure = ['-S', path.join(input.repositoryRoot, 'scripts/lib/motionscaper-reference-native'), '-B', build, '--fresh',
		'-G', input.target.startsWith('win-') ? 'Ninja Multi-Config' : 'Ninja', '-DCMAKE_BUILD_TYPE=Release',
		`-DCMAKE_TOOLCHAIN_FILE=${path.join(input.repositoryRoot, 'native/framescaper-media-host/build/toolchains', `${input.target}.cmake`)}`,
		`-DCMAKE_MAKE_PROGRAM=${input.tools.ninja}`, `-DFRAMESCAPER_C_COMPILER=${input.tools.c}`,
		`-DFRAMESCAPER_CXX_COMPILER=${input.tools.cxx}`, `-DPKG_CONFIG_EXECUTABLE=${input.tools.pkgConfig}`,
		...(input.tools.rc ? [`-DCMAKE_RC_COMPILER=${input.tools.rc}`] : []),
		`-DMOTION_REFERENCE_OUTPUT_DIRECTORY=${input.directory}`,
		`-DMOTION_REFERENCE_INCLUDE_DIRECTORIES=${input.installRoots.map(root => path.join(root, 'include')).join(';')}`,
		`-DMOTION_REFERENCE_LIBRARY_DIRECTORIES=${input.installRoots.map(root => path.join(root, 'lib')).join(';')}`];
	const commands: readonly MotionReferenceCompileCommand[] = [
		{ phase: 'configure', executable: input.tools.cmake, args: configure, cwd: input.repositoryRoot },
		{ phase: 'compile', executable: input.tools.cmake, args: ['--build', build, '--config', 'Release', '--target', 'motion-reference-decoder', '--parallel', '1'], cwd: input.repositoryRoot },
	];
	return { decoder, commands, compileBudgetMs: 60_000 as const };
}

export function createMotionReferenceCompileEnvironment(environment: Readonly<Record<string, string>>, installRoots: readonly string[], target: MotionNativeTarget): NodeJS.ProcessEnv {
	requireMotionReferenceInstallRoots(installRoots, target);
	const path = target.startsWith('win-') ? win32 : posix;
	// Node otherwise injects parent coverage into this object during spawn, changing its audited bytes.
	return { ...environment, NODE_V8_COVERAGE: undefined, PKG_CONFIG_LIBDIR: installRoots.flatMap(root => [path.join(root, 'lib/pkgconfig'), path.join(root, 'share/pkgconfig')]).join(target.startsWith('win-') ? ';' : ':'),
		PKG_CONFIG_PATH: '', PKG_CONFIG_SYSROOT_DIR: '', LC_ALL: 'C', TZ: 'UTC' };
}

/** Match the exact source-owned FFmpeg dependency recipe, including static SVT-AV1. */
function requireMotionReferenceInstallRoots(roots: readonly string[], target: MotionNativeTarget): void {
	const path = target.startsWith('win-') ? win32 : posix;
	const expected = ['ffmpeg-install', ...FRAMESCAPER_FFMPEG_POLICY.externalLibraries.map((name: string) => `${name}-install`)];
	if (roots.length !== expected.length || new Set(roots).size !== roots.length) throw new Error('Reference compiler install closure is incomplete.');
	const parent = path.dirname(roots[0]!);
	for (const [index, root] of roots.entries()) {
		if (!path.isAbsolute(root) || path.resolve(root) !== root || /[\0\r\n;]/u.test(root)
			|| path.dirname(root) !== parent || path.basename(root) !== expected[index]) throw new Error('Reference compiler install closure differs from its exact recipe roots.');
	}
}
