/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createBundledMidiInstrumentBuildPlan } from '../scripts/lib/bundled-midi-instrument-build.ts';

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

test('building a read-only source snapshot patches only its private copy and keeps Windows factory paths UTF-8', async context => {
	const { mkdtemp, mkdir, writeFile, readFile, chmod, rm } = await import('node:fs/promises');
	const { tmpdir } = await import('node:os');
	const { join } = await import('node:path');
	const { prepareBundledMidiInstrumentSources } = await import('../scripts/lib/bundled-midi-instrument-build.ts');
	const root = await mkdtemp(join(tmpdir(), 'bundled-instrument-copy-'));
	context.after(async () => { await chmod(join(root, 'source/src/common'), 0o700); await chmod(join(root, 'source/src'), 0o700); await chmod(join(root, 'source'), 0o700); await rm(root, { recursive: true, force: true }); });
	const sourceRoot = join(root, 'source');
	await mkdir(join(sourceRoot, 'src/common'), { recursive: true });
	await writeFile(join(sourceRoot, 'src/CMakeLists.txt'), 'include(cmake/pluginval.cmake)\n', { mode: 0o400 });
	const storage = 'datapath = fs::path{suppliedDataPath};\ndatapath = suppliedDataPath;\ndatapath = suppliedDataPath;\n'
		+ '    if (auto *c = getenv("SURGE_DATA_HOME"))\n    {\n        r = true;\n        v = c;\n    }';
	await writeFile(join(sourceRoot, 'src/common/SurgeStorage.cpp'), storage, { mode: 0o400 });
	for (const path of [sourceRoot, join(sourceRoot, 'src'), join(sourceRoot, 'src/common')]) await chmod(path, 0o500);
	const engine = createBundledMidiInstrumentBuildPlan({ target: 'linux-x64', sourceRoots: { 'surge-xt': sourceRoot, dexed: '/unused' },
		buildRoot: join(root, 'build'), installRoot: join(root, 'install') }).engines[0]!;
	prepareBundledMidiInstrumentSources(engine);
	assert.equal(await readFile(join(sourceRoot, 'src/common/SurgeStorage.cpp'), 'utf8'), storage);
	const patched = await readFile(join(engine.workSourceRoot, 'src/common/SurgeStorage.cpp'), 'utf8');
	assert.equal(patched.match(/fs::u8path\(suppliedDataPath\)/gu)?.length, 3);
	assert.match(patched, /_wgetenv\(L"SURGE_DATA_HOME"\)/u);
	await writeFile(join(engine.workSourceRoot, 'src/generated.h'), 'compiler generated');
});

test('macOS instrument working copies use AppKit snapshots with the current SDK', async context => {
	const { mkdtemp, mkdir, writeFile, readFile, rm } = await import('node:fs/promises');
	const { tmpdir } = await import('node:os');
	const { dirname, join } = await import('node:path');
	const { prepareBundledMidiInstrumentSources } = await import('../scripts/lib/bundled-midi-instrument-build.ts');
	const root = await mkdtemp(join(tmpdir(), 'bundled-instrument-macos-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const dexed = join(root, 'dexed');
	const path = 'libs/JUCE/modules/juce_gui_basics/native/juce_Windowing_mac.mm';
	const original = 'static Image createNSWindowSnapshot (NSWindow* nsWindow)\r\n{ CGWindowListCreateImage (); }\r\n'
		+ 'Image createSnapshotOfNativeWindow (void* nativeWindowHandle)\r\n{ return {}; }\r\n';
	await mkdir(dirname(join(dexed, path)), { recursive: true });
	await mkdir(join(dexed, 'source'));
	await writeFile(join(dexed, path), original);
	await writeFile(join(dexed, 'source/CMakeLists.txt'), 'COPY_PLUGIN_AFTER_BUILD TRUE\n');
	const { engines } = createBundledMidiInstrumentBuildPlan({ target: 'mac-arm64', sourceRoots: { 'surge-xt': join(root, 'surge'), dexed },
		buildRoot: join(root, 'build'), installRoot: join(root, 'install'), macosSdkPath: join(root, 'sdk') });
	const engine = engines.find(item => item.id === 'dexed')!;
	prepareBundledMidiInstrumentSources(engine);
	assert.equal(await readFile(join(dexed, path), 'utf8'), original);
	const patched = await readFile(join(engine.workSourceRoot, path), 'utf8');
	assert.match(patched, /#if defined \(MAC_OS_VERSION_15_0\)[\s\S]+cacheDisplayInRect[\s\S]+#else[\s\S]+CGWindowListCreateImage[\s\S]+#endif\s+Image createSnapshotOfNativeWindow/u);
});
