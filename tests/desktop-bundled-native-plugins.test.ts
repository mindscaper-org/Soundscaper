/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bundledNativePlugins, isBundledPluginResourcePath } from '../desktop/bundled-native-plugins.ts';

test('every desktop target ships OrbitAmp, the JUCE effects and two MIDI instruments', () => {
	for (const target of ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'] as const) {
		const plugins = bundledNativePlugins(target);
		assert.deepEqual(plugins.map(plugin => [plugin.name, plugin.format, plugin.classification]), [
			['Soundscaper JUCE effects', 'clap', 'effect'], ['OrbitAmp', 'vst3', 'effect'],
			['Surge XT', 'vst3', 'instrument'], ['Dexed', 'vst3', 'instrument'],
		]);
		const orbit = plugins.find(plugin => plugin.id === 'orbit-amp');
		assert.equal(orbit?.bundlePath, 'effects/OrbitAmp.vst3');
		assert.equal(orbit?.binaryPath, `effects/OrbitAmp.vst3/Contents/${{
			'linux-x64': 'x86_64-linux/OrbitAmp.so', 'linux-arm64': 'aarch64-linux/OrbitAmp.so',
			'mac-arm64': 'MacOS/OrbitAmp', 'win-x64': 'x86_64-win/OrbitAmp.vst3', 'win-arm64': 'arm64-win/OrbitAmp.vst3',
		}[target]}`);
		for (const plugin of plugins.filter(plugin => plugin.classification === 'instrument')) {
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

test('OrbitAmp factory files are data inside the exact VST3 bundle', () => {
	const factory = 'effects/OrbitAmp.vst3/Contents/Resources/Factory';
	for (const file of ['Friedman IR-X.orbitrig.zip', 'IRs/Top/Some Cab.wav', 'sets/OrbitAmp.txt']) {
		assert.equal(isBundledPluginResourcePath(`${factory}/${file}`), true, file);
	}
	for (const file of ['entry.so', 'IRs/cab.dll', 'sets/Other.txt', '../outside.wav', 'Friedman.zip']) {
		assert.equal(isBundledPluginResourcePath(`${factory}/${file}`), false, file);
	}
});
