/* SPDX-License-Identifier: AGPL-3.0-only */
import { join } from 'node:path';
import type { NativeTestFixtureKind, NativeTestFixtureRecipe } from './node-native-test-fixture-recipes.ts';

export function lightscaperGrantedNativeTestRecipeCurrentV1(kind: Extract<NativeTestFixtureKind,
	'lightscaper-granted-file-reader' | 'lightscaper-granted-filesystem' | 'lightscaper-granted-filesystem-close-fault'>, repositoryRoot: string): NativeTestFixtureRecipe {
	const reader = kind === 'lightscaper-granted-file-reader', fault = kind === 'lightscaper-granted-filesystem-close-fault';
	if (fault && process.platform !== 'linux') throw new Error('Actual close/EINTR fixture requires Linux.');
	const common = join(repositoryRoot, 'native/common'), role = join(repositoryRoot, 'native/lightscaper-granted-filesystem-current-v1');
	const sourceRoot = join(repositoryRoot, `tests/native/${reader ? 'lightscaper-granted-file-reader-current-v1' : 'lightscaper-granted-filesystem-current-v1'}`);
	return { kind, compiler: 'cmake', arguments: [],
		cmake: { sourceRoot, target: reader ? 'lightscaper_granted_file_reader_fixture'
			: fault ? 'lightscaper_granted_filesystem_close_fault_fixture' : 'lightscaper_granted_filesystem_fixture', definitions: [] },
		sources: [join(sourceRoot, 'CMakeLists.txt'), join(common, process.platform === 'win32' ? 'granted_file_reader_windows.cpp' : 'granted_file_reader_posix.cpp'),
			...reader ? [join(sourceRoot, 'fixture.cpp')] : [join(role, 'src/main.cpp'), join(role, 'src/protocol.cpp'), ...fault ? [join(sourceRoot, 'close_fault.cpp')] : []]],
		headerRoots: [common, ...reader ? [] : [join(role, 'include')]] };
}
