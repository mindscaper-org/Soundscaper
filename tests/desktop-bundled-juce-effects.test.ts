/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopPluginConsent } from '../desktop/plugin-consent.ts';
import { bundledJuceEffectsDirectory } from '../desktop/bundled-juce-effects.ts';

test('bundled effect locations follow the exact development or packaged target', () => {
	assert.equal(bundledJuceEffectsDirectory({ applicationRoot: '/app', packaged: false, platform: 'linux', arch: 'arm64' }),
		'/app/native/soundscaper-professional-host/prebuilt/linux-arm64/runtime/effects');
	assert.equal(bundledJuceEffectsDirectory({ applicationRoot: '/app/app.asar', resourcesPath: '/resources',
		packaged: true, platform: 'darwin', arch: 'arm64' }),
	'/resources/runtime/native/soundscaper-professional-host/mac-arm64/runtime/effects');
	assert.equal(bundledJuceEffectsDirectory({ applicationRoot: '/app', packaged: false, platform: 'darwin', arch: 'x64' }), undefined);
});

test('bundled JUCE effects are offered through CLAP discovery without granting consent', () => {
	const consent = new DesktopPluginConsent({
		pickDirectory: () => Promise.resolve(null), platform: 'linux',
		bundledEffectsDirectory: '/opt/soundscaper/runtime/effects',
	});
	const clap = consent.describe().formats.find(({ format }) => format === 'clap');
	const offered = clap?.roots.find(({ name }) => name === 'Soundscaper JUCE effects');
	assert.ok(offered);
	assert.equal(offered.admitted, false);
	assert.equal(clap?.granted, false);
	assert.throws(() => consent.scanTargets('clap'), /consent/iu);
	consent.grant('clap');
	consent.admitStandardRoot('clap', offered.rootId);
	assert.equal(consent.resolveRoot('clap', offered.rootId).path, '/opt/soundscaper/runtime/effects');
	assert.equal(consent.describe().formats.find(({ format }) => format === 'vst3')?.roots
		.some(({ name }) => name === 'Soundscaper JUCE effects'), false);
});

test('restored choices keep bundled effects opt-in and invalid paths are refused', () => {
	const options = { pickDirectory: () => Promise.resolve(null), platform: 'linux' };
	const saved = new DesktopPluginConsent(options).exportState();
	const restored = new DesktopPluginConsent({ ...options, state: saved,
		bundledEffectsDirectory: '/opt/soundscaper/runtime/effects' });
	assert.equal(restored.describe().scanningEnabled, false);
	assert.deepEqual(restored.exportState(), saved);
	assert.throws(() => new DesktopPluginConsent({ ...options,
		bundledEffectsDirectory: 'relative/effects' }), /bundled/iu);
});
