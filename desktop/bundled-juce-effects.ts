/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, join } from 'node:path';

export const BUNDLED_JUCE_EFFECTS_FILE = 'soundscaper_juce_effects.clap';
export const BUNDLED_JUCE_EFFECTS_RUNTIME_PATH = `effects/${BUNDLED_JUCE_EFFECTS_FILE}`;

/** Paths stay in main. Discovery still requires the ordinary format/folder consent. */
export function bundledJuceEffectsDirectory(location: Readonly<{
	applicationRoot: string;
	resourcesPath?: string;
	packaged: boolean;
	platform?: string;
	arch?: string;
}>): string | undefined {
	const platform = location.platform ?? process.platform;
	const arch = location.arch ?? process.arch;
	const target = platform === 'darwin' && arch === 'arm64' ? 'mac-arm64'
		: ['linux', 'win32'].includes(platform) && ['x64', 'arm64'].includes(arch)
			? `${platform === 'win32' ? 'win' : 'linux'}-${arch}` : null;
	if (target === null) return undefined;
	const root = location.packaged ? location.resourcesPath : location.applicationRoot;
	if (typeof root !== 'string' || !isAbsolute(root)) throw new TypeError('Bundled JUCE effects require an absolute application resource root.');
	return location.packaged
		? join(root, 'runtime/native/soundscaper-professional-host', target, 'runtime/effects')
		: join(root, 'native/soundscaper-professional-host/prebuilt', target, 'runtime/effects');
}
