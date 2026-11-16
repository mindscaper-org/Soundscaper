/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, toneA } from '../audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from '../audio-editor-test-helpers.js';
import { installDesktopSpeedWarmupManifest } from './desktop-speed-warmup-fixture.js';

export async function openVampAnalyzer(page, { features = [], noteOutput = null } = {}) {
	await installDesktopSpeedWarmupManifest(page);
	await page.addInitScript(({ features, noteOutput }) => {
		const analyzerId = 'onsets';
		const stableId = 'example-onsets';
		const binarySha256 = 'ab'.repeat(32);
		const output = { identifier: 'onsets', name: 'Onsets', description: '', unit: '', binCount: null,
			binNames: [], extents: null, quantizeStep: null, sampleType: 'variable-sample-rate',
			sampleRate: null, hasDuration: false };
		if (noteOutput) Object.assign(output, { identifier: noteOutput.id, name: 'Notes', unit: noteOutput.unit, hasDuration: true, binCount: 1 });
		globalThis.__moreVampConfigurations = [];
		const bridge = Object.fromEntries([
			'setNativeAudioHelperEnabled', 'describeNativeAudioBackend', 'setNativePluginConsent', 'scanNativePlugins',
			'openNativeAudioSession', 'bindNativeAudioSession', 'nativeAudioSessionStatus', 'calibrateNativeAudioSession',
			'reportNativeAudioSessionTransfer', 'reportNativeAudioSessionLoss', 'closeNativeAudioSession',
			'setNativePluginInstallationAllowed', 'selectNativePluginInstallation', 'instantiateNativePlugin',
			'runNativePluginOffline', 'setNativePluginBypassed', 'persistNativePluginState', 'restoreNativePluginState',
			'openNativePluginVendorUi', 'closeNativePluginVendorUi', 'closeNativePluginInstance',
		].map(name => [name, async () => { throw new Error(`Unexpected fixture call: ${name}`); }]));
		Object.assign(bridge, {
			getEnvironment: async () => null, signalReady: async () => undefined,
			onMenuCommand: () => () => undefined, onOpenProject: () => () => undefined,
			onCloseRequested: () => () => undefined, onWindowStateChanged: () => () => undefined,
			getExternalFfmpegStatus: async () => ({ state: 'unconfigured', location: null, version: null, detail: '', canInstall: false, canBrowse: false, canClear: false }),
			readNativeTierControls: async () => ({ probeHelperEnabled: false, probeHelperQuarantined: false,
				audioHelperEnabled: false, audioHelperQuarantined: false, nativeEffectDiscoveryEnabled: true }),
			nativeAudioHelperAvailability: async () => ({ enabled: false, quarantined: false,
				payload: { status: 'unavailable', reason: 'fixture', detail: '' }, backends: [] }),
			nativePluginAvailability: async () => ({ enabled: true, quarantined: false,
				payload: { status: 'available', reason: null }, formats: [{ format: 'vamp', consented: true }],
				consent: { scanningEnabled: false, formats: [] },
				quarantine: { loaded: true, degraded: false, records: [], pendingFaults: 0 } }),
			listNativePlugins: async () => ({ entries: [] }),
			listNativeVampAnalyzers: async () => [{ analyzerId, stableId, binarySha256,
				name: 'Onsets', maker: 'Fixture', programs: ['Sensitive'], parameters: [{ id: 'threshold',
					name: 'Threshold', description: '', unit: '', minValue: 0, maxValue: 1,
					defaultValue: 0.5, quantizeStep: null }], outputs: [{ id: output.identifier, name: output.name,
						description: '', unit: output.unit, sampleType: 'variable-sample-rate', sampleRate: null, hasDuration: output.hasDuration }],
				configuration: { inputDomain: 'time', minimumChannels: 1, maximumChannels: 2,
					preferredStepSize: 512, preferredBlockSize: 1024 } }],
			startNativeVampAnalyzer: async () => ({ sessionId: 'fixture-session' }),
			configureNativeVampAnalyzer: async request => {
				globalThis.__moreVampConfigurations.push(request);
				return { kind: 'analyzer-session', format: 'vamp', sessionId: request.sessionId, analyzerId,
					installationId: stableId, binarySha256, state: 'configured', processedFrames: 0,
					totalFrames: request.frameCount, outputs: [output] };
			},
			pushNativeVampAnalyzerPcm: async () => ({ features: [] }),
			finishNativeVampAnalyzer: async () => ({ features }),
			cancelNativeVampAnalyzer: async () => true,
		});
		Object.defineProperty(globalThis, 'soundscaperDesktop', { configurable: true, value: { v1: bridge } });
	}, { features, noteOutput });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await clipByName(editor, toneA.name).click();
	await page.keyboard.press('Control+a');
	await chooseCommandAction(page, editor, 'Analyze', 'Vamp Plugins');
	const dialog = page.getByRole('dialog', { name: 'Vamp Analyzer', exact: true });
	await expect(dialog.getByRole('combobox', { name: 'Program', exact: true })).toBeVisible();
	return dialog;
}
