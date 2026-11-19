/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ORBITAMP_SOURCE_IDS } from '../desktop/bundled-native-plugins.ts';
import { createBundledOrbitAmpBuildPlan, prepareBundledOrbitAmpSources, stageOrbitAmpFactory } from '../scripts/lib/bundled-orbitamp-build.ts';

test('OrbitAmp builds only the native VST3 from the exact local inputs', () => {
	const root = tmpdir();
	const sourceRoots = Object.fromEntries(ORBITAMP_SOURCE_IDS.map(id => [id, join(root, id)]));
	const plan = createBundledOrbitAmpBuildPlan({
		target: 'win-arm64', sourceRoots, buildRoot: join(root, 'build'), installRoot: join(root, 'install'),
	});
	assert.ok(plan.configure.includes('ARM64'));
	assert.ok(plan.configure.includes('-DFETCHCONTENT_FULLY_DISCONNECTED=ON'));
	assert.ok(plan.configure.includes(`-DFETCHCONTENT_SOURCE_DIR_NAMZ_SRC=${sourceRoots['orbit-namz']}`));
	assert.deepEqual(plan.buildArguments.slice(4, 6), ['--target', 'OrbitAmp_VST3']);
	assert.equal(plan.binary, join(root, 'install/runtime/effects/OrbitAmp.vst3/Contents/arm64-win/OrbitAmp.vst3'));
});

test('the factory staging copies the listed amp and cabinet files into the bundle', context => {
	const root = mkdtempSync(join(tmpdir(), 'soundscaper-orbitamp-'));
	context.after(() => rmSync(root, { force: true, recursive: true }));
	const factory = join(root, 'Factory'), staged = join(root, 'BundleFactory');
	mkdirSync(join(factory, 'sets'), { recursive: true });
	mkdirSync(join(factory, 'IRs/Factory'), { recursive: true });
	const manifestPath = 'sets/OrbitAmp.txt', model = 'Friedman.orbitrig.zip', cabinet = 'IRs/Factory/Cabinet.wav';
	writeFileSync(join(factory, model), 'model');
	writeFileSync(join(factory, cabinet), 'cabinet');
	writeFileSync(join(factory, 'Unused.orbitrig.zip'), 'another amp');
	const manifest = `# OrbitAmp factory sounds\n${model}\n${cabinet}\n`;
	writeFileSync(join(factory, manifestPath), manifest);
	stageOrbitAmpFactory(factory, staged);
	assert.equal(readFileSync(join(staged, manifestPath), 'utf8'), manifest);
	assert.equal(readFileSync(join(staged, model), 'utf8'), 'model');
	assert.equal(readFileSync(join(staged, cabinet), 'utf8'), 'cabinet');
	assert.throws(() => readFileSync(join(staged, 'Unused.orbitrig.zip')), { code: 'ENOENT' });

	for (const invalid of ['../escaped.orbitrig.zip', 'IRs/Factory/native.so', cabinet]) {
		writeFileSync(join(factory, manifestPath), manifest + invalid + '\n');
		assert.throws(() => stageOrbitAmpFactory(factory, staged), /factory inventory is invalid/u);
	}
});

test('the build patches a working copy for local factory lookup and immediate rendering', context => {
	const root = mkdtempSync(join(tmpdir(), 'soundscaper-orbitamp-src-'));
	context.after(() => rmSync(root, { force: true, recursive: true }));
	const sourceRoots = Object.fromEntries(ORBITAMP_SOURCE_IDS.map(id => [id, join(root, id)]));
	for (const directory of Object.values(sourceRoots)) mkdirSync(directory);
	const upstream = sourceRoots['orbit-amp']!;
	mkdirSync(join(upstream, 'src/device'), { recursive: true });
	mkdirSync(join(upstream, 'src/core'));
	const factory = '    static juce::File location()\n    {\n        const auto places = installedPlaces();\n'
		+ '    }\n\n    /** Whether the folder this build reads is there at all. */\n';
	const prepare = '    bool inlineLoads = false;\n';
	const restore = '        apply (self, t);\n        self.pendingRestores.fetch_sub (1, order);\n'
		+ '    pumpDeviceWork();\n\n    // ...and the AMP';
	const pump = '    void pump (juce::ThreadPool* pool)';
	for (const [file, source] of [['src/device/FactorySet.h', factory], ['src/PluginProcessor.h', prepare],
		['src/PluginProcessor.cpp', restore], ['src/core/CapturedBlock.h', pump]] as const) writeFileSync(join(upstream, file), source);
	const plan = createBundledOrbitAmpBuildPlan({
		target: 'linux-x64', sourceRoots, buildRoot: join(root, 'build'), installRoot: join(root, 'install'),
	});
	prepareBundledOrbitAmpSources(plan);
	assert.match(readFileSync(join(plan.source, 'src/device/FactorySet.h'), 'utf8'), /Resources\/Factory/u);
	assert.match(readFileSync(join(plan.source, 'src/PluginProcessor.h'), 'utf8'), /inlineLoads = true/u);
	assert.match(readFileSync(join(plan.source, 'src/PluginProcessor.cpp'), 'utf8'),
		/apply \(self, t\);\s+self\.pumpDeviceWork\(\);/u);
	assert.match(readFileSync(join(plan.source, 'src/core/CapturedBlock.h'), 'utf8'), /player\.serviceHere/u);
	assert.equal(readFileSync(join(upstream, 'src/device/FactorySet.h'), 'utf8'), factory);
	assert.equal(readFileSync(join(upstream, 'src/PluginProcessor.h'), 'utf8'), prepare);
	assert.equal(readFileSync(join(upstream, 'src/PluginProcessor.cpp'), 'utf8'), restore);
});
