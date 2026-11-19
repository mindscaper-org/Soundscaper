/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bundledNativePlugins, isBundledPluginResourcePath } from '../desktop/bundled-native-plugins.ts';

test('every desktop target ships two MIDI instruments and the separate JUCE effect library', () => {
	for (const target of ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'] as const) {
		const plugins = bundledNativePlugins(target);
		assert.deepEqual(plugins.map(plugin => [plugin.name, plugin.format, plugin.classification]), [
			['Soundscaper JUCE effects', 'clap', 'effect'], ['Surge XT', 'vst3', 'instrument'], ['Dexed', 'vst3', 'instrument'],
		]);
		for (const plugin of plugins.slice(1)) {
			assert.match(plugin.binaryPath, /^instruments\/.+\.vst3\/Contents\//u);
			assert.equal(plugin.bundlePath, `instruments/${plugin.name}.vst3`);
		}
		assert.equal(plugins.some(plugin => plugin.name === 'Surge XT Effects'), false);
	}
	assert.throws(() => bundledNativePlugins('mac-x64'), /target/iu);
});

test('factory resources cannot masquerade as another native runtime binary or escape their instrument bundle', () => {
	assert.equal(isBundledPluginResourcePath('instrument-data/surge-xt/wavetables/Basic/Classic.wt'), true);
	assert.equal(isBundledPluginResourcePath('instruments/Dexed.vst3/Contents/Info.plist'), true);
	for (const path of ['../outside', 'instrument-data/surge-xt/../../other',
		'instrument-data/surge-xt/backdoor.dll', 'instruments/Other.vst3/Contents/Info.plist',
		'instruments/Surge XT.vst3/Contents/x86_64-linux/Surge XT.so']) {
		assert.equal(isBundledPluginResourcePath(path), false, path);
	}
});
