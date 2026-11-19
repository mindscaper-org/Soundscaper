/* SPDX-License-Identifier: AGPL-3.0-only */

export const BUNDLED_PLUGIN_RESOURCE_LIMIT = 8192;
export const BUNDLED_PLUGIN_RESOURCE_BYTE_LIMIT = 512 * 1024 * 1024;
export const BUNDLED_SURGE_DATA_PATH = 'instrument-data/surge-xt';
export const BUNDLED_ORBITAMP_PATH = 'effects/OrbitAmp.vst3';
export const BUNDLED_ORBITAMP_FACTORY_PATH = `${BUNDLED_ORBITAMP_PATH}/Contents/Resources/Factory`;
export const ORBITAMP_FETCHCONTENT = Object.freeze({
	'orbit-juce': 'JUCE',
	'orbit-core': 'FELITRONICS_CORE',
	'orbit-guitar': 'FELITRONICS_GUITAR_CORE',
	'orbit-appkit': 'FELITRONICS_APPKIT',
	'orbit-cab-ir': 'CAB_IR_GENERATOR',
	'orbit-nam-core': 'NAM_CORE_SRC',
	'orbit-eigen': 'EIGEN_SRC',
	'orbit-namz': 'NAMZ_SRC',
	'orbit-toml': 'FELITRONICS_TOML',
	'orbit-webp': 'LIBWEBP',
	'orbit-json': 'NLOHMANN_JSON',
});
export const ORBITAMP_SOURCE_IDS = Object.freeze([
	'orbit-amp', ...Object.keys(ORBITAMP_FETCHCONTENT),
	'orbit-clap-extensions', 'orbit-clap', 'orbit-clap-helpers',
]);

export interface BundledNativePlugin {
	readonly id: string;
	readonly name: string;
	readonly format: 'clap' | 'vst3';
	readonly classification: 'effect' | 'instrument';
	readonly bundlePath: string;
	readonly binaryPath: string;
}

/** Main/build authority for app-provided plug-ins; names from external scans confer no trust. */
export function bundledNativePlugins(target: string): readonly BundledNativePlugin[] {
	const architecture = ({ 'linux-x64': 'x86_64-linux', 'linux-arm64': 'aarch64-linux',
		'mac-arm64': 'MacOS', 'win-x64': 'x86_64-win', 'win-arm64': 'arm64-win' } as Record<string, string>)[target];
	if (!architecture) throw new TypeError('Unsupported bundled plug-in target.');
	const extension = target.startsWith('linux-') ? '.so' : target.startsWith('win-') ? '.vst3' : '';
	return Object.freeze([
		Object.freeze({ id: 'juce-effects', name: 'Soundscaper JUCE effects', format: 'clap' as const, classification: 'effect' as const,
			bundlePath: 'effects/soundscaper_juce_effects.clap', binaryPath: 'effects/soundscaper_juce_effects.clap' }),
		Object.freeze({ id: 'orbit-amp', name: 'OrbitAmp', format: 'vst3' as const, classification: 'effect' as const,
			bundlePath: BUNDLED_ORBITAMP_PATH, binaryPath: `${BUNDLED_ORBITAMP_PATH}/Contents/${architecture}/OrbitAmp${extension}` }),
		...['Surge XT', 'Dexed'].map(name => {
			const bundlePath = `instruments/${name}.vst3`;
			return Object.freeze({ id: name === 'Dexed' ? 'dexed' : 'surge-xt', name, format: 'vst3' as const,
				classification: 'instrument' as const, bundlePath, binaryPath: `${bundlePath}/Contents/${architecture}/${name}${extension}` });
		}),
	]);
}

/** Keep data outside the native-code file inventory. */
export function isBundledPluginResourcePath(path: string): boolean {
	if (path.includes('\\') || path.split('/').some(segment => !segment || segment === '.' || segment === '..')) return false;
	if (path.startsWith(`${BUNDLED_ORBITAMP_FACTORY_PATH}/`)) {
		return isOrbitAmpFactoryFile(path.slice(BUNDLED_ORBITAMP_FACTORY_PATH.length + 1));
	}
	if (/^(?:instruments\/(?:Surge XT|Dexed)|effects\/OrbitAmp)\.vst3\/Contents\/(?:Info\.plist|PkgInfo|_CodeSignature\/CodeResources|Resources\/(?:moduleinfo\.json|.+\.(?:icns|png)))$/u.test(path)) return true;
	return path.startsWith(`${BUNDLED_SURGE_DATA_PATH}/`)
		&& !/\.(?:dll|so|dylib|exe|node|clap|vst3|app|bundle)$/iu.test(path);
}

export function isOrbitAmpFactoryFile(path: string): boolean {
	if (/[\\<>:"|?*\p{Cc}]/u.test(path) || path.split('/').some(segment => !segment || /[. ]$/u.test(segment))) return false;
	return path === 'sets/OrbitAmp.txt' || /^[^/]+\.orbitrig\.zip$/u.test(path) || /^IRs\/.+\.wav$/iu.test(path);
}

/** Framescaper uses the shared host and JUCE effects. */
export function isSoundscaperOnlyBundledPluginArtifactPath(path: string): boolean {
	return /(?:^|\/)runtime\/(?:instruments\/|instrument-data\/|effects\/OrbitAmp\.vst3\/)/u.test(path.replaceAll('\\', '/'));
}
