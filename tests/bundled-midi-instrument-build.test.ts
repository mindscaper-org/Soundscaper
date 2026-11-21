/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createBundledMidiInstrumentBuildPlan, prepareBundledMidiInstrumentSources } from '../scripts/lib/bundled-midi-instrument-build.ts';

const STORAGE = 'datapath = fs::path{suppliedDataPath};\ndatapath = suppliedDataPath;\ndatapath = suppliedDataPath;\n'
	+ '    if (auto *c = getenv("SURGE_DATA_HOME"))\n    {\n        r = true;\n        v = c;\n    }';
const WINDOWING = 'libs/JUCE/modules/juce_gui_basics/native/juce_Windowing_mac.mm';
const SNAPSHOT = 'static Image createNSWindowSnapshot (NSWindow* nsWindow)\r\n{ CGWindowListCreateImage (); }\r\n'
	+ 'Image createSnapshotOfNativeWindow (void* nativeWindowHandle)\r\n{ return {}; }\r\n';

async function writeFixture(root: string, path: string, contents: string, mode?: number): Promise<void> {
	const file = join(root, path);
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, contents, { mode });
}

async function writeSurgeFixture(sourceRoot: string, mode?: number): Promise<void> {
	await writeFixture(sourceRoot, 'src/CMakeLists.txt', 'include(cmake/pluginval.cmake)\n', mode);
	await writeFixture(sourceRoot, 'src/common/SurgeStorage.cpp', STORAGE, mode);
}

test('native instrument recipes build only VST3 instruments on every maintained target without user installation', () => {
	for (const target of ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']) {
		const plan = createBundledMidiInstrumentBuildPlan({ target, sourceRoots: { 'surge-xt': '/sources/surge', dexed: '/sources/dexed' },
			buildRoot: '/work/instruments', installRoot: '/install', macosSdkPath: '/sdk' });
		assert.deepEqual(plan.engines.map(engine => engine.targetName), ['surge-xt_VST3', 'Dexed_VST3']);
		assert.ok(plan.engines[0]!.configure.includes('-DSURGE_BUILD_FX=OFF'));
		assert.ok(plan.engines[0]!.configure.includes('-DSURGE_COPY_AFTER_BUILD=OFF'));
		assert.ok(plan.engines[0]!.configure.includes('-DCMAKE_POLICY_VERSION_MINIMUM=3.5'));
		for (const engine of plan.engines) {
			assert.deepEqual(engine.build.slice(-2), ['--parallel', '2']);
			assert.ok(engine.configure.includes('-DBUILD_TESTING=OFF'));
			assert.equal(engine.configure.some(value => value.includes('COPY_PLUGIN_AFTER_BUILD=TRUE')), false);
			if (target.startsWith('win-')) assert.ok(engine.configure.includes(target === 'win-arm64' ? 'ARM64' : 'x64'));
			if (target === 'mac-arm64') assert.ok(engine.configure.includes('-DCMAKE_OSX_ARCHITECTURES=arm64'));
		}
	}
});

test('unqualified targets and nonabsolute source paths cannot form a build recipe', () => {
	const options = { target: 'linux-x64', sourceRoots: { 'surge-xt': '/surge', dexed: '/dexed' }, buildRoot: '/build', installRoot: '/install' };
	assert.throws(() => createBundledMidiInstrumentBuildPlan({ ...options, target: 'win-ia32' }), /target/iu);
	assert.throws(() => createBundledMidiInstrumentBuildPlan({ ...options, sourceRoots: { ...options.sourceRoots, dexed: '../dexed' } }), /absolute/iu);
});

test('Windows Surge XT patches LuaJIT enum operands and UTF-8 paths in the private working copy', async context => {
	const root = await mkdtemp(join(tmpdir(), 'bundled-instrument-copy-'));
	context.after(async () => { await chmod(join(root, 'source/src/common'), 0o700); await chmod(join(root, 'source/src'), 0o700); await chmod(join(root, 'source'), 0o700); await rm(root, { recursive: true, force: true }); });
	const sourceRoot = join(root, 'source');
	await writeSurgeFixture(sourceRoot, 0o400);
	const luaPath = 'libs/LuaJitLib/LuaJIT/src/lj_ccallback.c';
	const lua = '*p++ = XI_MOVrib | RID_EAX;\n*p++ = XI_MOVri | RID_EBP;\n';
	await writeFixture(sourceRoot, luaPath, lua, 0o400);
	for (const path of [sourceRoot, join(sourceRoot, 'src'), join(sourceRoot, 'src/common')]) await chmod(path, 0o500);
	const engine = createBundledMidiInstrumentBuildPlan({ target: 'win-x64', sourceRoots: { 'surge-xt': sourceRoot, dexed: join(root, 'unused') },
		buildRoot: join(root, 'build'), installRoot: join(root, 'install') }).engines[0]!;
	prepareBundledMidiInstrumentSources(engine);
	assert.equal(await readFile(join(sourceRoot, 'src/common/SurgeStorage.cpp'), 'utf8'), STORAGE);
	assert.equal(await readFile(join(sourceRoot, luaPath), 'utf8'), lua);
	assert.equal(await readFile(join(engine.workSourceRoot, luaPath), 'utf8'),
		'*p++ = XI_MOVrib | (int)RID_EAX;\n*p++ = XI_MOVri | (int)RID_EBP;\n');
	const patched = await readFile(join(engine.workSourceRoot, 'src/common/SurgeStorage.cpp'), 'utf8');
	assert.equal(patched.match(/fs::u8path\(suppliedDataPath\)/gu)?.length, 3);
	assert.match(patched, /_wgetenv\(L"SURGE_DATA_HOME"\)/u);
	await writeFile(join(engine.workSourceRoot, 'src/generated.h'), 'compiler generated');
});

test('macOS Dexed working copies retain the selected architecture and use AppKit snapshots', async context => {
	const root = await mkdtemp(join(tmpdir(), 'bundled-instrument-macos-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const dexed = join(root, 'dexed');
	const cmake = 'if (CMAKE_BUILD_TYPE STREQUAL "Release")\n    set(CMAKE_OSX_ARCHITECTURES "x86_64;arm64" CACHE INTERNAL "")\nendif()\n';
	await writeFixture(dexed, 'CMakeLists.txt', cmake);
	await writeFixture(dexed, WINDOWING, SNAPSHOT);
	await writeFixture(dexed, 'source/CMakeLists.txt', 'COPY_PLUGIN_AFTER_BUILD TRUE\n');
	const { engines } = createBundledMidiInstrumentBuildPlan({ target: 'mac-arm64', sourceRoots: { 'surge-xt': join(root, 'surge'), dexed },
		buildRoot: join(root, 'build'), installRoot: join(root, 'install'), macosSdkPath: join(root, 'sdk') });
	const engine = engines.find(item => item.id === 'dexed')!;
	prepareBundledMidiInstrumentSources(engine);
	assert.equal(await readFile(join(dexed, 'CMakeLists.txt'), 'utf8'), cmake);
	assert.match(await readFile(join(engine.workSourceRoot, 'CMakeLists.txt'), 'utf8'),
		/if \(NOT DEFINED CMAKE_OSX_ARCHITECTURES AND CMAKE_BUILD_TYPE STREQUAL "Release"\)/u);
	assert.equal(await readFile(join(dexed, WINDOWING), 'utf8'), SNAPSHOT);
	const patched = await readFile(join(engine.workSourceRoot, WINDOWING), 'utf8');
	assert.match(patched, /#if defined \(MAC_OS_VERSION_15_0\)[\s\S]+cacheDisplayInRect[\s\S]+#else[\s\S]+CGWindowListCreateImage[\s\S]+#endif\s+Image createSnapshotOfNativeWindow/u);
});

test('macOS Surge XT orders the native LuaJIT archive before VST3 linking and guards its standalone CLI', async context => {
	const root = await mkdtemp(join(tmpdir(), 'bundled-surge-macos-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const sourceRoot = join(root, 'surge');
	await writeSurgeFixture(sourceRoot);
	await writeFixture(sourceRoot, WINDOWING, SNAPSHOT);
	const luaPath = 'libs/LuaJitLib/CMakeLists.txt';
	const lua = 'if(APPLE AND NOT CMAKE_CROSSCOMPILING)\n  message(STATUS "fat mode")\nendif()\n';
	await writeFixture(sourceRoot, luaPath, lua);
	const path = 'src/surge-xt/CMakeLists.txt';
	const cmake = 'if(APPLE)\n  add_dependencies(${PROJECT_NAME}_Standalone ${PROJECT_NAME}-cli)\nendif()\n';
	await writeFixture(sourceRoot, path, cmake);
	const { engines } = createBundledMidiInstrumentBuildPlan({ target: 'mac-arm64', sourceRoots: { 'surge-xt': sourceRoot, dexed: join(root, 'dexed') },
		buildRoot: join(root, 'build'), installRoot: join(root, 'install'), macosSdkPath: join(root, 'sdk') });
	const engine = engines[0]!;
	prepareBundledMidiInstrumentSources(engine);
	assert.equal(await readFile(join(sourceRoot, path), 'utf8'), cmake);
	assert.ok((await readFile(join(engine.workSourceRoot, path), 'utf8'))
		.startsWith('if(APPLE AND TARGET ${PROJECT_NAME}_Standalone)\n  add_dependencies'));
	assert.equal(await readFile(join(sourceRoot, luaPath), 'utf8'), lua);
	const recipe = await readFile(join(engine.workSourceRoot, luaPath), 'utf8');
	assert.match(recipe, /STREQUAL "arm64"[\s\S]+BUILDMODE=static[\s\S]+BYPRODUCTS[^\n]+libluajit\.a/u);
	assert.match(recipe, /add_dependencies\(luajit-5\.1 soundscaper_luajit_arm64\)[\s\S]+elseif\(APPLE AND NOT CMAKE_CROSSCOMPILING\)/u);
});

test('Windows ARM64 Surge XT links the pinned SIMDe headers and preserves floating-point state', async context => {
	const root = await mkdtemp(join(tmpdir(), 'bundled-surge-win-arm64-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const sourceRoot = join(root, 'surge');
	await writeSurgeFixture(sourceRoot);
	const cmakePath = 'src/common/CMakeLists.txt';
	const cmake = 'elseif(WIN32)\n  target_compile_definitions(${PROJECT_NAME} PUBLIC\n    WINDOWS=1\n  )\nendif()\n';
	await writeFixture(sourceRoot, cmakePath, cmake);
	const oscillatorPath = 'src/common/dsp/oscillators/WindowOscillator.cpp';
	const oscillator = '#ifdef _MSC_VER\n    const auto c{__emulu(a, b)};\n#else\n    const auto c{std::uint64_t{a} * std::uint64_t{b}};\n#endif\n';
	await writeFixture(sourceRoot, oscillatorPath, oscillator);
	const mathPath = 'libs/simde/simde/simde-math.h';
	const math = '#if defined(HUGE_VAL)\n  /* A math header was already included. */\n#endif\n';
	await writeFixture(sourceRoot, mathPath, math);
	const path = 'libs/sst/sst-plugininfra/src/cpufeatures.cpp';
	const cpu = [
		'#include "sst/plugininfra/cpufeatures.h"',
		'#ifdef _WIN32\n#include <intrin.h>\n#define cpuid(info, x) __cpuidex(info, x, 0)',
		'#if !USING_X86\n#error "Windows only works on X86 right now"\n#endif',
		'#elif WINDOWS\n    std::string platform = "Windows";',
		'#if defined(__arm__) || defined(__aarch64__)',
		'#if defined(__aarch64__)\n    uint64_t FPCR = 0;',
		'#if defined(__aarch64__)\n    asm volatile("MSR FPCR, %0 " : : "r"(priorS));',
	].join('\n');
	await writeFixture(sourceRoot, path, cpu);
	const { engines } = createBundledMidiInstrumentBuildPlan({ target: 'win-arm64', sourceRoots: { 'surge-xt': sourceRoot, dexed: join(root, 'dexed') },
		buildRoot: join(root, 'build'), installRoot: join(root, 'install') });
	prepareBundledMidiInstrumentSources(engines[0]!);
	assert.equal(await readFile(join(sourceRoot, cmakePath), 'utf8'), cmake);
	assert.match(await readFile(join(engines[0]!.workSourceRoot, cmakePath), 'utf8'),
		/elseif\(WIN32\)\n {2}target_link_libraries\(\$\{PROJECT_NAME\} PUBLIC surge::simde\)/u);
	assert.equal(await readFile(join(sourceRoot, oscillatorPath), 'utf8'), oscillator);
	assert.match(await readFile(join(engines[0]!.workSourceRoot, oscillatorPath), 'utf8'),
		/#if defined\(_MSC_VER\) && !defined\(_M_ARM64\)\n {4}const auto c\{__emulu\(a, b\)\};/u);
	assert.equal(await readFile(join(sourceRoot, mathPath), 'utf8'), math);
	assert.match(await readFile(join(engines[0]!.workSourceRoot, mathPath), 'utf8'),
		/^#if defined\(_MSC_VER\) && defined\(__cplusplus\)\n {2}#include <cmath>\n {2}#define SIMDE_MATH_HAVE_CMATH\n#elif defined\(HUGE_VAL\)/u);
	assert.equal(await readFile(join(sourceRoot, path), 'utf8'), cpu);
	const patched = await readFile(join(engines[0]!.workSourceRoot, path), 'utf8');
	assert.doesNotMatch(patched, /Windows only works on X86/u);
	assert.match(patched, /#if defined\(_WIN32\) && USING_X86\n#include <intrin.h>/u);
	assert.match(patched, /_controlfp\(0, 0\) & _MCW_DN/u);
	assert.match(patched, /_controlfp\(_DN_FLUSH, _MCW_DN\)/u);
	assert.match(patched, /_controlfp\(priorS, _MCW_DN\)/u);
});
