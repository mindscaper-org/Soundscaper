/* SPDX-License-Identifier: AGPL-3.0-only */

export const BUNDLED_PLUGIN_RESOURCE_LIMIT = 8192;
export const BUNDLED_PLUGIN_RESOURCE_BYTE_LIMIT = 512 * 1024 * 1024;
export const BUNDLED_SURGE_DATA_PATH = 'instrument-data/surge-xt';
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
	return Object.freeze([
		Object.freeze({ id: 'juce-effects', name: 'Soundscaper JUCE effects', format: 'clap' as const, classification: 'effect' as const,
			bundlePath: 'effects/soundscaper_juce_effects.clap', binaryPath: 'effects/soundscaper_juce_effects.clap' }),
		...['Surge XT', 'Dexed'].map(name => {
			const bundlePath = `instruments/${name}.vst3`;
			const extension = target.startsWith('linux-') ? '.so' : target.startsWith('win-') ? '.vst3' : '';
			return Object.freeze({ id: name === 'Dexed' ? 'dexed' : 'surge-xt', name, format: 'vst3' as const,
				classification: 'instrument' as const, bundlePath, binaryPath: `${bundlePath}/Contents/${architecture}/${name}${extension}` });
		}),
	]);
}

/** Only data inside the two instrument bundles is outside the native-code file inventory. */
export function isBundledPluginResourcePath(path: string): boolean {
	if (path.includes('\\') || path.split('/').some(segment => !segment || segment === '.' || segment === '..')) return false;
	if (/^instruments\/(?:Surge XT|Dexed)\.vst3\/Contents\/(?:Info\.plist|PkgInfo|_CodeSignature\/CodeResources|Resources\/(?:moduleinfo\.json|.+\.(?:icns|png)))$/u.test(path)) return true;
	return path.startsWith(`${BUNDLED_SURGE_DATA_PATH}/`)
		&& !/\.(?:dll|so|dylib|exe|node|clap|vst3|app|bundle)$/iu.test(path);
}

/** Framescaper shares the effect host but has no MIDI tracks or instrument payload. */
export function isBundledInstrumentArtifactPath(path: string): boolean {
	return /(?:^|\/)runtime\/(?:instruments|instrument-data)\//u.test(path.replaceAll('\\', '/'));
}
