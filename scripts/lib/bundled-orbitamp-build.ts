/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import {
	BUNDLED_ORBITAMP_FACTORY_PATH, BUNDLED_ORBITAMP_PATH, ORBITAMP_FETCHCONTENT,
	bundledNativePlugins, isOrbitAmpFactoryFile,
} from '../../desktop/bundled-native-plugins.ts';

interface Options {
	readonly target: string;
	readonly sourceRoots: Readonly<Record<string, string>>;
	readonly buildRoot: string;
	readonly installRoot: string;
	readonly macosSdkPath?: string;
}

export function createBundledOrbitAmpBuildPlan(options: Options) {
	const plugin = bundledNativePlugins(options.target).find(entry => entry.id === 'orbit-amp')!;
	const root = absolute(options.buildRoot);
	const install = absolute(options.installRoot);
	const source = join(root, 'source');
	const build = join(root, 'build');
	const clap = join(root, 'clap-juce-extensions');
	const inputs = Object.entries(ORBITAMP_FETCHCONTENT).map(([id, name]) =>
		`-DFETCHCONTENT_SOURCE_DIR_${name}=${absolute(options.sourceRoots[id])}`);
	const selection = options.target.startsWith('win-')
		? ['-A', options.target === 'win-arm64' ? 'ARM64' : 'x64', '-DCMAKE_SYSTEM_VERSION=10.0.26100',
			'-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded']
		: [];
	const sdk = options.target === 'mac-arm64'
		? ['-DCMAKE_OSX_ARCHITECTURES=arm64', `-DCMAKE_OSX_SYSROOT=${absolute(options.macosSdkPath)}`]
		: [];
	return Object.freeze({
		source, build,
		upstream: absolute(options.sourceRoots['orbit-amp']),
		clapSources: Object.freeze([
			Object.freeze([absolute(options.sourceRoots['orbit-clap-extensions']), clap] as const),
			Object.freeze([absolute(options.sourceRoots['orbit-clap']), join(clap, 'clap-libs', 'clap')] as const),
			Object.freeze([absolute(options.sourceRoots['orbit-clap-helpers']), join(clap, 'clap-libs', 'clap-helpers')] as const),
		]),
		configure: Object.freeze(['-S', source, '-B', build, ...selection, ...sdk, ...inputs,
			`-DFETCHCONTENT_SOURCE_DIR_CLAP-JUCE-EXTENSIONS=${clap}`, '-DFETCHCONTENT_FULLY_DISCONNECTED=ON',
			'-DCMAKE_BUILD_TYPE=Release', '-DORBITAMP_COPY_PLUGIN=OFF', '-DORBITAMP_DEV_FACTORY=OFF',
			'-DORBITAMP_NAM_CORE_SRC=', '-DORBITAMP_NAMZ_SRC=']),
		buildArguments: Object.freeze(['--build', build, '--config', 'Release', '--target', 'OrbitAmp_VST3', '--parallel', '2']),
		output: join(build, 'OrbitAmp_artefacts', 'Release', 'VST3', 'OrbitAmp.vst3'),
		factory: join(build, 'Factory'),
		binary: join(install, 'runtime', plugin.binaryPath),
		destination: join(install, 'runtime', BUNDLED_ORBITAMP_PATH),
		factoryDestination: join(install, 'runtime', BUNDLED_ORBITAMP_FACTORY_PATH),
	});
}

export function prepareBundledOrbitAmpSources(plan: ReturnType<typeof createBundledOrbitAmpBuildPlan>): void {
	cpSync(plan.upstream, plan.source, { recursive: true });
	patchSource(plan.source, 'src/device/FactorySet.h', bundleOrbitAmpFactoryLocation);
	// The rig requests captures from its audio block. Prime it with silence on
	// the control thread before the peer begins playback or an immediate bounce.
	patchSource(plan.source, 'src/core/CapturedBlock.h', source => replaceOnce(source,
		'    void pump (juce::ThreadPool* pool)',
		`    void primeBundledModels (int maxFrames, int channels, double sampleRate)
    {
        const int frames = juce::jmin (maxFrames, 512);
        juce::AudioBuffer<float> silence (channels, frames);
        // Allow both model slots to request and warm their captures without
        // advancing any of the amp's other stages.
        const double rate = juce::jlimit (48000.0, 768000.0, sampleRate);
        const int warmupFrames = juce::roundToInt (4096.0 * rate / 48000.0);
        const int blocks = juce::jmax (8, (warmupFrames + frames - 1) / frames);
        for (int i = 0; i < blocks; ++i)
        {
            silence.clear();
            player.process (silence.getArrayOfWritePointers(), channels, frames);
            player.warmQuiet (4 * blocks);
            player.serviceHere();
        }
        if (onLanded) onLanded();
    }

    void pump (juce::ThreadPool* pool)`));
	patchSource(plan.source, 'src/PluginProcessor.h', source =>
		replaceOnce(source, 'bool inlineLoads = false;', 'bool inlineLoads = true;'));
	patchSource(plan.source, 'src/PluginProcessor.cpp', source => {
		const restored = replaceOnce(source, '        apply (self, t);\n        self.pendingRestores.fetch_sub',
			`        apply (self, t);
        self.pumpDeviceWork();
        self.pumpSwitchNames();
        self.pumpDeviceWork();
        if (const int frames = self.preparedBlock.load(); frames > 0)
            self.preamp.primeBundledModels (frames, self.getTotalNumInputChannels(), self.getSampleRate());
        self.pendingRestores.fetch_sub`);
		return replaceOnce(restored, '    pumpDeviceWork();\n\n    // ...and the AMP',
			'    pumpDeviceWork();\n    preamp.primeBundledModels (block, getTotalNumInputChannels(), sampleRate);\n\n    // ...and the AMP');
	});
	for (const [source, destination] of plan.clapSources) {
		mkdirSync(dirname(destination), { recursive: true });
		chmodSync(dirname(destination), 0o700);
		mkdirSync(destination, { recursive: true });
		chmodSync(destination, 0o700);
		cpSync(source, destination, { recursive: true });
	}
}

export function executeBundledOrbitAmpBuild(plan: ReturnType<typeof createBundledOrbitAmpBuildPlan>): void {
	prepareBundledOrbitAmpSources(plan);
	for (const arguments_ of [plan.configure, plan.buildArguments]) {
		const result = spawnSync('cmake', arguments_, { stdio: 'inherit', shell: false,
			env: { ...process.env, ORBITAMP_BUILDER: 'Soundscaper', GIT_CEILING_DIRECTORIES: dirname(plan.source) } });
		if (result.error) throw result.error;
		if (result.status !== 0) throw new Error(`OrbitAmp VST3 build failed (${result.status}).`);
	}
	cpSync(plan.output, plan.destination, { recursive: true });
	if (!lstatSync(plan.binary).isFile()) throw new Error('OrbitAmp built without the target VST3 binary.');
	stageOrbitAmpFactory(plan.factory, plan.factoryDestination);
}

function bundleOrbitAmpFactoryLocation(source: string): string {
	const functionStart = '    static juce::File location()\n    {\n';
	const nextMethod = '\n    /** Whether the folder this build reads is there at all. */';
	const start = source.indexOf(functionStart);
	const end = source.indexOf(nextMethod, start);
	if (start === -1 || end === -1 || !source.slice(start, end).includes('const auto places = installedPlaces();')) {
		throw new Error('The pinned OrbitAmp factory location patch does not apply.');
	}
	// JUCE resolves the plug-in module itself for currentExecutableFile. The hosting
	// peer snapshots the whole VST3, so its factory data travels with the module.
	return source.slice(0, start) + functionStart
		+ '        return juce::File::getSpecialLocation (juce::File::currentExecutableFile)\n'
		+ '                   .getParentDirectory().getParentDirectory().getChildFile ("Resources/Factory");\n'
		+ '    }\n' + source.slice(end);
}

export function stageOrbitAmpFactory(source: string, destination: string): void {
	const manifest = 'sets/OrbitAmp.txt';
	const contents = readFileSync(join(source, manifest), 'utf8');
	const files = contents.split(/\r?\n/u).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
	if (new Set(files).size !== files.length || files.includes(manifest)
		|| !files.some(file => file.endsWith('.orbitrig.zip')) || !files.some(file => /\.wav$/iu.test(file))
		|| files.some(file => !isOrbitAmpFactoryFile(file))) throw new Error('OrbitAmp factory inventory is invalid.');
	for (const file of [manifest, ...files]) {
		const input = join(source, file);
		if (!lstatSync(input).isFile()) throw new Error(`Invalid OrbitAmp factory file: ${file}`);
		const output = join(destination, file);
		mkdirSync(dirname(output), { recursive: true });
		cpSync(input, output);
	}
}

function patchSource(root: string, file: string, patch: (source: string) => string): void {
	const path = join(root, file);
	chmodSync(path, 0o600);
	writeFileSync(path, patch(readFileSync(path, 'utf8')));
}

function replaceOnce(source: string, original: string, replacement: string): string {
	if (source.indexOf(original) < 0 || source.indexOf(original) !== source.lastIndexOf(original)) {
		throw new Error('The pinned OrbitAmp model-loading patch does not apply.');
	}
	return source.replace(original, replacement);
}

function absolute(path: string | undefined): string {
	if (path === undefined || !isAbsolute(path)) throw new TypeError('OrbitAmp requires absolute pinned source and SDK paths.');
	return path;
}
