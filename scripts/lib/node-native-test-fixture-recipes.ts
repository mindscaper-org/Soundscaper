/* SPDX-License-Identifier: AGPL-3.0-only */

import { basename, join } from 'node:path';
import { lightscaperRawNativeTestRecipeCurrentV1 } from './lightscaper-raw-native-test-recipe-current-v1.ts';

type ExistingNativeTestFixtureKind = 'media-contract' | 'media-contract-exact' | 'media-validator' | 'delivery-filesystem';
export type NativeTestFixtureKind = ExistingNativeTestFixtureKind | 'lightscaper-granted-file-reader' | 'lightscaper-raw-engine';
export interface NativeTestFixtureRecipe {
	readonly kind: NativeTestFixtureKind;
	readonly compiler: string;
	readonly arguments: readonly string[];
	readonly sources: readonly string[];
	readonly headerRoots: readonly string[];
}

export function mediaContractFixtureKind(environment: NodeJS.ProcessEnv = process.env): NativeTestFixtureKind {
	return environment.FRAMESCAPER_BOOST_192_SOURCE_ROOT ? 'media-contract-exact' : 'media-contract';
}

export function nativeTestFixtureRecipes(repositoryRoot: string, environment: NodeJS.ProcessEnv = process.env): Readonly<Record<ExistingNativeTestFixtureKind, NativeTestFixtureRecipe>> {
	const media = join(repositoryRoot, 'native/framescaper-media-host/src');
	const common = join(repositoryRoot, 'native/common');
	const delivery = join(repositoryRoot, 'native/soundscaper-professional-host/src');
	const closure = environment.FRAMESCAPER_BOOST_192_SOURCE_ROOT;
	const boost = closure ? ['-I', closure] : [];
	const warnings = ['-std=c++20', '-Wall', '-Wextra', '-Wpedantic', '-Werror'];
	const mediaSources = [
		'media_host.cpp', 'image_sequence_pack.cpp', 'legacy_plan_semantics.cpp',
		'legacy_plan_v8_filter_semantics.cpp', 'media_file_grants.cpp',
		'media_host_arguments.cpp', 'media_plan.cpp', 'sha256.cpp', 'strict_json.cpp',
	].map(name => join(media, name));
	mediaSources.push(join(common, 'sha256.cpp'));
	const headerRoots = [media, common];
	const recipe = (kind: NativeTestFixtureKind, arguments_: readonly string[], sources: readonly string[], roots = headerRoots, compiler = 'c++'): NativeTestFixtureRecipe => ({
		kind, compiler, arguments: arguments_, sources, headerRoots: roots,
	});
	return {
		'media-contract': recipe('media-contract', [...warnings, '-DFRAMESCAPER_MEDIA_HOST_CONTRACT_ONLY=1', '-I', media], mediaSources),
		'media-contract-exact': recipe('media-contract-exact', [...warnings, '-DFRAMESCAPER_MEDIA_HOST_CONTRACT_ONLY=1', ...boost, '-I', media], mediaSources, [...headerRoots, ...closure ? [closure] : []]),
		'media-validator': recipe('media-validator', [...warnings, ...boost, '-I', media], [
			join(repositoryRoot, 'native/framescaper-media-host/tests/unified_plan_admission_fixture.cpp'),
			...['media_plan.cpp', 'legacy_plan_semantics.cpp', 'legacy_plan_v8_filter_semantics.cpp', 'media_file_grants.cpp', 'sha256.cpp', 'strict_json.cpp'].map(name => join(media, name)),
			join(common, 'sha256.cpp'),
		], [...headerRoots, ...closure ? [closure] : []]),
		'delivery-filesystem': recipe('delivery-filesystem', ['-std=c++20', '-O2', '-Wall', '-Wextra', '-Werror', '-pthread'], [
			join(common, 'sha256.cpp'), ...['delivery_fs_main.cpp', 'delivery_fs_protocol.cpp', 'delivery_fs_sha256.cpp', 'delivery_fs_posix.cpp', 'delivery_fs_linux.cpp'].map(name => join(delivery, name)),
		], [delivery, common], 'g++'),
	};
}

/** Select before constructing a recipe: unrelated tests need no RAW sources. */
export function nativeTestFixtureRecipe(kind: NativeTestFixtureKind, repositoryRoot: string, environment: NodeJS.ProcessEnv): NativeTestFixtureRecipe {
	if (kind === 'lightscaper-raw-engine') return lightscaperRawNativeTestRecipeCurrentV1(repositoryRoot, environment);
	if (kind === 'lightscaper-granted-file-reader') {
		const common = join(repositoryRoot, 'native/common');
		return { kind, compiler: 'c++', arguments: ['-std=c++20', '-O2', '-Wall', '-Wextra', '-Wpedantic', '-Werror', '-pthread', '-I', common],
			sources: [join(repositoryRoot, 'tests/native/lightscaper-granted-file-reader-current-v1/fixture.cpp'),
				join(common, process.platform === 'win32' ? 'granted_file_reader_windows.cpp' : 'granted_file_reader_posix.cpp')], headerRoots: [common] };
	}
	return nativeTestFixtureRecipes(repositoryRoot, environment)[kind];
}

/** Select only binaries the requested tests can execute in this host configuration. */
export function selectedNativeTestFixtures(testFiles: readonly string[], environment: NodeJS.ProcessEnv = process.env, exactRetimeAvailable = false): readonly NativeTestFixtureKind[] {
	const kinds = new Set<NativeTestFixtureKind>();
	const names = new Set(testFiles.map(file => basename(file)));
	if (names.has('framescaper-media-host-source-manifest.test.js') || names.has('framescaper-media-host-legacy-plan-admission.test.js')) kinds.add('media-contract');
	if (names.has('framescaper-media-host-unified-vfr-parity.test.js') || exactRetimeAvailable && names.has('framescaper-media-host-native-adapters.test.js')) kinds.add(mediaContractFixtureKind(environment));
	if (exactRetimeAvailable && (names.has('framescaper-media-host-unified-vfr-parity.test.js') || names.has('framescaper-media-host-unified-validator-parity.test.js'))) kinds.add('media-validator');
	if (process.platform === 'linux' && (names.has('soundscaper-delivery-fs-native.test.js') || names.has('desktop-soundscaper-delivery-filesystem-native-e2e.test.ts'))) kinds.add('delivery-filesystem');
	if (names.has('lightscaper-native-granted-file-reader-current.test.ts')) kinds.add('lightscaper-granted-file-reader');
	if (names.has('lightscaper-native-raw-engine-current.test.ts')) kinds.add('lightscaper-raw-engine');
	return [...kinds].sort();
}
