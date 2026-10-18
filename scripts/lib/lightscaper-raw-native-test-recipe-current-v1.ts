/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { NativeTestFixtureRecipe } from './node-native-test-fixture-recipes.ts';

/** Test-only additive recipe. Root supplies an owned extraction of the exact
 * manifest-pinned LibRaw archive. The shared fixture builder fingerprints all
 * extracted inputs; this environment path never enters a production grant. */
export function lightscaperRawNativeTestRecipeCurrentV1(repositoryRoot: string, environment: NodeJS.ProcessEnv): Omit<NativeTestFixtureRecipe, 'kind'> & Readonly<{ kind: 'lightscaper-raw-engine' }> {
 const location = environment.LIGHTSCAPER_LIBRAW_SOURCE_ROOT;
 if (!location || !isAbsolute(location) || location.includes('\0')) throw new Error('Root must supply the actual pinned LibRaw0.22.2 extraction for native engine qualification.');
 const source = realpathSync.native(location), engine = join(repositoryRoot, 'native/lightscaper-raw-engine-current-v1');
 const makefile = readFileSync(join(source, 'Makefile.am'), 'utf8').replace(/\\\r?\n/gu, ' ');
 const assignment = /^lib_libraw_a_SOURCES\s*=([^\r\n]*)$/mu.exec(makefile)?.[1];
 const units = assignment?.trim().split(/\s+/u) ?? [];
 if (units.length < 50 || units.length > 128 || new Set(units).size !== units.length
  || units.some(value => !/^src\/(?:[a-z0-9_]+\/)*[a-z0-9_]+\.cpp$/u.test(value))) throw new Error('Native test LibRaw source inventory is invalid.');
 for (const unit of units) if (!statSync(join(source, unit)).isFile()) throw new Error('Native test LibRaw source unit is missing.');
 return Object.freeze({ kind: 'lightscaper-raw-engine', compiler: 'c++', arguments: Object.freeze([
  '-std=c++20', '-O2', '-Wall', '-Wextra', '-ffp-contract=off', '-fno-fast-math', '-fno-finite-math-only', '-pthread',
  '-DLIBRAW_NOTHREADS=1', '-DLIBRAW_NO_IOSTREAMS_DATASTREAM=', '-DLIBRAW_MAX_THUMBNAIL_MB=16',
  '-UUSE_JPEG', '-UUSE_ZLIB', '-UUSE_LCMS', '-UUSE_LCMS2', '-UUSE_RAWSPEED', '-UUSE_RAWSPEED3', '-UUSE_DNGSDK', '-UUSE_X3FTOOLS', '-U_OPENMP',
  '-I', source, '-I', join(engine, 'include'),
 ]), sources: Object.freeze([
  join(engine, 'tests/engine_fixture.cpp'), join(engine, 'src/raw_engine.cpp'), join(engine, 'src/raw_recovery.cpp'), join(engine, 'src/raw_preview.cpp'),
  ...units.map(value => join(source, value)),
 ]), headerRoots: Object.freeze([join(engine, 'include'), source]) });
}
