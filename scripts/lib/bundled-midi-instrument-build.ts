/* SPDX-License-Identifier: AGPL-3.0-only */
import { chmodSync, cpSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { BUNDLED_SURGE_DATA_PATH, bundledNativePlugins } from '../../desktop/bundled-native-plugins.ts';

interface EngineBuild {
	readonly id: 'surge-xt' | 'dexed';
	readonly target: string;
	readonly sourceRoot: string;
	readonly workSourceRoot: string;
	readonly buildRoot: string;
	readonly targetName: string;
	readonly configure: readonly string[];
	readonly build: readonly string[];
	readonly output: string;
}
interface Options {
	readonly target: string;
	readonly sourceRoots: Readonly<Record<'surge-xt' | 'dexed', string>>;
	readonly buildRoot: string;
	readonly installRoot: string;
	readonly macosSdkPath?: string;
}

export function createBundledMidiInstrumentBuildPlan(options: Options) {
	const plugins = bundledNativePlugins(options.target).filter(plugin => plugin.classification === 'instrument');
	const root = absolute(options.buildRoot), installRoot = absolute(options.installRoot);
	const selection = options.target.startsWith('win-') ? ['-A', options.target === 'win-arm64' ? 'ARM64' : 'x64'] : [];
	const engines = plugins.map(plugin => {
		const id = plugin.id as 'surge-xt' | 'dexed';
		const workSourceRoot = join(root, `${id}-source`), buildRoot = join(root, `${id}-build`);
		const targetName = id === 'surge-xt' ? 'surge-xt_VST3' : 'Dexed_VST3';
		const configure = ['-S', workSourceRoot, '-B', buildRoot, ...selection, '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_TESTING=OFF',
			'-DJUCE_COPY_PLUGIN_AFTER_BUILD=FALSE', ...(id === 'surge-xt' ? ['-DSURGE_BUILD_FX=OFF', '-DSURGE_BUILD_TESTRUNNER=OFF',
				'-DCMAKE_POLICY_VERSION_MINIMUM=3.5', // Surge's pinned libsamplerate predates the CMake 4 policy floor.
				'-DSURGE_COPY_AFTER_BUILD=OFF', '-DSURGE_COPY_TO_PRODUCTS=OFF', '-DSURGE_SKIP_STANDALONE=ON',
				'-DSURGE_SKIP_WERROR=ON', `-DSURGE_SKIP_LUA=${options.target === 'win-arm64' ? 'ON' : 'OFF'}`] : ['-DBUILD_ID=Soundscaper'])];
		if (options.target === 'mac-arm64') configure.push('-DCMAKE_OSX_ARCHITECTURES=arm64', `-DCMAKE_OSX_SYSROOT=${absolute(options.macosSdkPath)}`);
		const artefacts = id === 'surge-xt' ? 'src/surge-xt/surge-xt_artefacts' : 'source/Dexed_artefacts';
		const output = join(buildRoot, artefacts, 'Release/VST3', `${plugin.name}.vst3`);
		return Object.freeze({ id, target: options.target, sourceRoot: absolute(options.sourceRoots[id]), workSourceRoot, buildRoot, targetName,
			configure: Object.freeze(configure), build: Object.freeze(['--build', buildRoot, '--config', 'Release', '--target', targetName, '--parallel', '2']), output });
	});
	return Object.freeze({ target: options.target, installRoot, engines: Object.freeze(engines) });
}

/** Compile private working copies; the authenticated source snapshots remain unchanged. */
export function executeBundledMidiInstrumentBuild(plan: ReturnType<typeof createBundledMidiInstrumentBuildPlan>): void {
	for (const engine of plan.engines) {
		prepareBundledMidiInstrumentSources(engine);
		for (const args of [engine.configure, engine.build]) {
			const result = spawnSync('cmake', args, { stdio: 'inherit', shell: false });
			if (result.error) throw result.error;
			if (result.status !== 0) throw new Error(`Bundled ${engine.id} native build failed (${result.status}).`);
		}
		const destination = join(plan.installRoot, 'runtime/instruments', engine.id === 'dexed' ? 'Dexed.vst3' : 'Surge XT.vst3');
		mkdirSync(destination, { recursive: true });
		cpSync(engine.output, destination, { recursive: true });
		if (engine.id === 'surge-xt') cpSync(join(engine.sourceRoot, 'resources/data'),
			join(plan.installRoot, 'runtime', BUNDLED_SURGE_DATA_PATH), { recursive: true });
	}
}

export function prepareBundledMidiInstrumentSources(engine: EngineBuild): void {
	mkdirSync(engine.workSourceRoot, { recursive: true });
	cpSync(engine.sourceRoot, engine.workSourceRoot, { recursive: true, force: true });
	const writable = (path: string) => {
		const metadata = lstatSync(path);
		if (metadata.isSymbolicLink() || !metadata.isDirectory() && !metadata.isFile()) throw new Error('A bundled instrument working source must contain only regular files and directories.');
		chmodSync(path, metadata.isDirectory() ? 0o700 : 0o600);
		if (metadata.isDirectory()) for (const name of readdirSync(path)) writable(join(path, name));
	};
	writable(engine.workSourceRoot);
	patchWorkingSource(engine);
}

function patchWorkingSource(engine: EngineBuild): void {
	const patch = (file: string, from: string, to: string) => {
		const path = join(engine.workSourceRoot, file), source = readFileSync(path, 'utf8');
		if (!source.includes(from)) throw new Error(`The pinned ${engine.id} source patch does not apply: ${file}`);
		chmodSync(path, 0o600);
		writeFileSync(path, source.replaceAll(from, to), { mode: 0o600 });
	};
	if (engine.id === 'dexed') patch('source/CMakeLists.txt', 'COPY_PLUGIN_AFTER_BUILD TRUE', 'COPY_PLUGIN_AFTER_BUILD FALSE');
	else {
		patch('src/CMakeLists.txt', 'include(cmake/pluginval.cmake)', '# Soundscaper builds only the instrument; upstream pluginval assumes the FX target also exists.');
		if (engine.target === 'mac-arm64') {
			const standalone = '\n  add_dependencies(${PROJECT_NAME}_Standalone ${PROJECT_NAME}-cli)';
			patch('src/surge-xt/CMakeLists.txt', `if(APPLE)${standalone}`,
				'if(APPLE AND TARGET ${PROJECT_NAME}_Standalone)' + standalone);
		}
		if (engine.target === 'win-x64') {
			// MSVC diagnoses mixed enum operands in the x86 callback emitter. Preserve the integer encoding.
			const callbacks = 'libs/LuaJitLib/LuaJIT/src/lj_ccallback.c';
			patch(callbacks, 'XI_MOVrib | RID_EAX', 'XI_MOVrib | (int)RID_EAX');
			patch(callbacks, 'XI_MOVri | RID_EBP', 'XI_MOVri | (int)RID_EBP');
		}
		// SURGE_DATA_HOME arrives as UTF-8, including under Windows installations with non-ASCII paths.
		patch('src/common/SurgeStorage.cpp', 'fs::path{suppliedDataPath}', 'fs::u8path(suppliedDataPath)');
		patch('src/common/SurgeStorage.cpp', 'datapath = suppliedDataPath;', 'datapath = fs::u8path(suppliedDataPath);');
		patch('src/common/SurgeStorage.cpp', '    if (auto *c = getenv("SURGE_DATA_HOME"))\n    {\n        r = true;\n        v = c;\n    }',
			'#if defined(_WIN32)\n    if (auto *c = _wgetenv(L"SURGE_DATA_HOME"))\n    {\n        r = true;\n        auto bytes = fs::path(c).u8string();\n        v.assign(bytes.begin(), bytes.end());\n    }\n#else\n    if (auto *c = getenv("SURGE_DATA_HOME"))\n    {\n        r = true;\n        v = c;\n    }\n#endif');
	}
	if (engine.target === 'mac-arm64') {
		const windowing = 'libs/JUCE/modules/juce_gui_basics/native/juce_Windowing_mac.mm';
		const snapshot = 'static Image createNSWindowSnapshot (NSWindow* nsWindow)';
		const entry = 'Image createSnapshotOfNativeWindow (void* nativeWindowHandle)';
		// The macOS 15 SDK removes the legacy CoreGraphics window snapshot API.
		// Capture the plugin window's own content through AppKit on newer SDKs.
		patch(windowing, snapshot, `#if defined (MAC_OS_VERSION_15_0) && MAC_OS_X_VERSION_MAX_ALLOWED >= MAC_OS_VERSION_15_0
${snapshot}
{
    JUCE_AUTORELEASEPOOL
    {
        NSView* content = [nsWindow contentView];
        const auto bounds = [content bounds];
        if (NSIsEmptyRect (bounds))
            return {};

        auto* bitmap = [content bitmapImageRepForCachingDisplayInRect: bounds];
        if (bitmap == nil)
            return {};

        [content cacheDisplayInRect: bounds toBitmapImageRep: bitmap];
        Image image (Image::ARGB, (int) [bitmap pixelsWide], (int) [bitmap pixelsHigh], true);
        CGContextDrawImage (juce_getImageContext (image),
                            CGRectMake (0, 0, [bitmap pixelsWide], [bitmap pixelsHigh]), [bitmap CGImage]);
        return image;
    }
}
#else
${snapshot}`);
		patch(windowing, entry, `#endif\n\n${entry}`);
	}
}

function absolute(value: string | undefined): string {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value || value.includes('\0')) throw new TypeError('A native instrument build path must be absolute and normalized.');
	return value;
}
