/* SPDX-License-Identifier: AGPL-3.0-only */

import { installDesktopSpeedWarmupManifest } from './helpers/desktop-speed-warmup-fixture.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	getMenuItem,
	openNestedCommandMenu,
	waitForEditor,
} from './audio-editor-test-helpers.js';

test('Audio settings and Audio setup share host selection without native-helper dialogs', async ({ page }) => {
	await installNativeServicesFixture(page, false, true);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Audio settings$/u }).click();
	const host = preferences.getByRole('combobox', { name: 'Host', exact: true });
	await expect(host).toHaveValue('electron');
	await expect(host).toContainText('Electron');
	await expect(host).toContainText('ALSA');
	await expect(host).toContainText('PipeWire');
	await expect(preferences.getByRole('button', { name: 'Enable microphones', exact: true })).toHaveCount(0);
	await expect(preferences.getByRole('button', { name: 'Native audio device', exact: true })).toHaveCount(0);
	await expect(preferences.getByRole('button', { name: 'Native audio and latency', exact: true })).toHaveCount(0);
	await expect(preferences.getByRole('checkbox', { name: 'Use Native Audio Helper', exact: true })).toHaveCount(0);
	await host.selectOption('alsa');
	await expect(preferences.getByRole('combobox', { name: 'Microphone', exact: true })).toContainText('Studio interface');
	await expect(preferences.getByRole('combobox', { name: 'Speakers', exact: true })).toContainText('Studio interface');
	const sampleRate = preferences.getByRole('combobox', { name: 'Recording sample rate', exact: true });
	await sampleRate.selectOption('96000');
	await expect(sampleRate).toHaveValue('96000');
	await expect.poll(() => page.evaluate(() => globalThis.__nativeHostOpenRequests.some((request) => request.sampleRate === 96000))).toBe(true);
	await preferences.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: /^Close$/u }).click();
	await editor.locator('[data-action-bar]').getByRole('button', { name: 'Audio setup', exact: true }).click();
	const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
	await expect(setup.getByRole('combobox', { name: 'Host', exact: true })).toHaveValue('alsa');
	await expect(setup.getByRole('combobox', { name: 'Recording sample rate', exact: true })).toHaveValue('96000');
	await expect(setup.getByRole('radiogroup', { name: 'Recording channels', exact: true })).toBeVisible();
	await expect(setup).toContainText('Choose the number of channels for your next recording.');
	await page.reload();
	const reloaded = await waitForEditor(page);
	await reloaded.locator('[data-action-bar]').getByRole('button', { name: 'Audio setup', exact: true }).click();
	const restored = reloaded.getByRole('dialog', { name: 'Audio setup', exact: true });
	await expect(restored.getByRole('combobox', { name: 'Host', exact: true })).toHaveValue('alsa');
	await expect(restored.getByRole('combobox', { name: 'Recording sample rate', exact: true })).toHaveValue('96000');
	await expect(restored.getByRole('combobox', { name: 'Microphone', exact: true })).toContainText('Studio interface');
});

test('switching audio hosts replaces devices and refresh preserves the chosen inventory', async ({ page }) => {
	await installNativeServicesFixture(page, false, true);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-action-bar]').getByRole('button', { name: 'Audio setup', exact: true }).click();
	const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
	const host = setup.getByRole('combobox', { name: 'Host', exact: true });
	const microphone = setup.getByRole('combobox', { name: 'Microphone', exact: true });
	const speakers = setup.getByRole('combobox', { name: 'Speakers', exact: true });
	await host.selectOption('alsa');
	await expect(microphone).toContainText('Studio interface');
	await host.selectOption('pipewire');
	await expect(microphone).toContainText('PipeWire interface');
	await expect(microphone).not.toContainText('Studio interface');
	await expect(speakers).toContainText('PipeWire interface');
	await setup.getByRole('button', { name: 'Refresh devices', exact: true }).click();
	await expect(microphone).toContainText('PipeWire interface');
	await expect(setup.getByRole('alert')).toContainText('The selected audio device could not be opened. Refresh audio devices or choose another device.');
	await host.selectOption('electron');
	await expect(microphone).not.toContainText('PipeWire interface');
	await expect(speakers).not.toContainText('PipeWire interface');
	await expect(setup.getByRole('button', { name: 'Enable microphones', exact: true })).toHaveCount(0);
	await expect(setup.getByRole('combobox', { name: 'Recording sample rate', exact: true })).toHaveCount(0);
	await expect(page.locator('[data-soundscaper-native-services-dialog="true"]')).toHaveCount(0);
});

test('Plugin Manager stays available with processing off and supports keyboard and narrow themes', async ({ page }) => {
	await installNativeServicesFixture(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Effect', 'Plugin Manager');
	const dialog = page.getByRole('dialog', { name: 'Plugin Manager', exact: true });
	await expect(dialog.getByRole('tab', { name: 'Devices', exact: true })).toHaveCount(0);
	await dialog.getByRole('textbox', { name: 'Search plugins' }).fill('no plugin');
	await expect(dialog.getByRole('table')).toBeVisible();
	const installed = dialog.getByRole('tab', { name: 'Installed', exact: true });
	await installed.focus();
	await installed.press('ArrowRight');
	await expect(installed).toBeFocused();
	await expect(dialog.getByRole('tab', { name: 'Scanning & Settings' })).toHaveCount(0);
	await page.setViewportSize({ width: 390, height: 844 });
	for (const theme of ['dark', 'light']) {
		await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
		await expect(dialog.locator('.button').first()).toHaveCSS('--button-bg-idle', theme === 'dark' ? '#515A63' : '#D3D4DC');
		const box = await dialog.boundingBox();
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(390);
	}
	await page.emulateMedia({ forcedColors: 'active' });
	await expect(installed).toBeFocused();
	await page.setViewportSize({ width: 1280, height: 720 });
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(editor.getByRole('menuitem', { name: 'Effect', exact: true })).toBeFocused();
	await expect.poll(() => page.evaluate(() => globalThis.__soundscaperNativeRuntimeCalls)).toEqual([]);
});

test('Plugin Manager filters installed rows and allows only the selected installation', async ({ page }) => {
	await installNativeServicesFixture(page, true);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Effect', 'Plugin Manager');
	const dialog = page.getByRole('dialog', { name: 'Plugin Manager', exact: true });
	const search = dialog.getByRole('textbox', { name: 'Search plugins' });
	await expect(dialog.locator('[data-native-plugin-entry]')).toHaveCount(2);
	await dialog.getByRole('button', { name: 'Status', exact: true }).click();
	await page.getByRole('option', { name: 'Needs attention', exact: true }).click();
	await expect(dialog.locator('[data-native-plugin-entry]')).toHaveCount(1);
	await dialog.getByRole('button', { name: 'Echo', exact: true }).click();
	await expect(dialog.getByRole('region', { name: 'Plugin details' })).toContainText('Allow this installation before use.');
	await search.fill('absent');
	await expect(dialog.getByRole('region', { name: 'Plugin details' })).toHaveCount(0);
	await expect(dialog.getByText('No plugins match these filters.', { exact: true })).toBeVisible();
	await search.fill('Echo');
	await expect.poll(() => page.evaluate(() => globalThis.__soundscaperNativeRuntimeCalls)).toEqual([]);
	await dialog.locator('[data-native-plugin-allowance="allow"]').click();
	await expect.poll(() => page.evaluate(() => globalThis.__soundscaperNativeRuntimeCalls)).toEqual(['allowance:echo-install:true']);
	await expect(dialog.locator('[data-native-plugin-allowance="revoke"]')).toBeVisible();
	await expect(dialog.locator('[data-native-plugin-instantiate]')).toHaveCount(0);
});

test('Framescaper never exposes the Soundscaper native-services surface', async ({ page }) => {
	await installNativeServicesFixture(page);
	const framescaper = await bootEditor(page, '/framescaper/embed/en/');
	await expect(framescaper).toHaveAttribute('data-product', 'framescaper');
	const framescaperTools = await openNestedCommandMenu(page, framescaper, 'Tools', []);
	await expect(getMenuItem(framescaperTools, 'Audio setup')).toHaveCount(0);
	await page.keyboard.press('Escape');
	const framescaperEffects = await openNestedCommandMenu(page, framescaper, 'Effect', []);
	await expect(getMenuItem(framescaperEffects, 'Native effects')).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(page.locator('[data-soundscaper-native-services-dialog="true"]')).toHaveCount(0);
	await expect.poll(() => page.evaluate(() => globalThis.__soundscaperNativeRuntimeCalls)).toEqual([]);
});

test('Effects preferences manages supported plugin folders without format switches', async ({ page }) => {
	await installNativeServicesFixture(page, false, false, true);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Effects$/u }).click();
	const folders = preferences.getByRole('group', { name: 'VST3', exact: true });
	await expect(folders).toBeVisible();
	await expect(preferences.getByText('Not available on this system', { exact: true })).toHaveCount(0);
	await expect(preferences.getByRole('group', { name: 'Audio Units', exact: true })).toHaveCount(0);
	await expect(preferences.getByRole('button', { name: /Allow scanning|Stop scanning|Admit folder/u })).toHaveCount(0);
	const system = folders.getByRole('checkbox', { name: 'System VST3 folder', exact: true });
	await expect(system).not.toBeChecked();
	await system.click();
	await expect(system).toBeChecked();
	await expect.poll(() => page.evaluate(() => globalThis.__soundscaperNativeRuntimeCalls))
		.toEqual(['consent:vst3:grant:', 'consent:vst3:add-standard-root:system-vst3']);
	await folders.getByRole('button', { name: 'Add path: VST3', exact: true }).click();
	await expect(folders.getByText('/opt/vendor/plugins', { exact: true })).toBeVisible();
	await expect(folders.getByRole('checkbox')).toHaveCount(1);
	await folders.getByRole('button', { name: 'Remove path: /opt/vendor/plugins', exact: true }).click();
	await expect(folders.getByText('/opt/vendor/plugins', { exact: true })).toHaveCount(0);
	await system.click();
	await expect(system).not.toBeChecked();
	await expect(preferences.getByRole('button', { name: 'Scan for plugins', exact: true })).toBeDisabled();
	await system.click();
	await expect(system).toBeChecked();
	await preferences.getByRole('checkbox', { name: 'Enable plugin scanning', exact: true }).click();
	await expect(preferences.getByRole('button', { name: 'Scan for plugins', exact: true })).toBeEnabled();
	await preferences.getByRole('button', { name: 'Scan for plugins', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__soundscaperNativeRuntimeCalls))
		.toContain('scan:vst3:system-vst3');
	await preferences.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: /^Close$/u }).click();
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	await preferences.getByRole('tab', { name: /Effects$/u }).click();
	await expect(folders.getByRole('checkbox', { name: 'System VST3 folder', exact: true })).toBeChecked();
	await folders.getByRole('button', { name: 'Add path: VST3', exact: true }).click();
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(folders.getByText('/opt/vendor/plugins', { exact: true })).toBeVisible();
	await expect(folders.getByRole('button', { name: 'Add path: VST3', exact: true })).toBeVisible();
	const box = await folders.boundingBox();
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(390);
});

test('desktop startup scans in the background with a progress toast and a preferences cancellation link', async ({ page }) => {
	await installNativeServicesFixture(page, false, false, true, { startup: true });
	const editor = await bootEditor(page, '/embed/en/');
	const toast = editor.getByRole('region', { name: 'Scanning for plugins', exact: true });
	await expect(toast).toBeVisible();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(toast.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
	await page.evaluate(() => globalThis.__setSoundscaperPluginScanProgress(0.5));
	await expect(toast.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
	const tracksBefore = Number(await editor.getAttribute('data-track-count'));
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
	await expect(editor).toHaveAttribute('data-track-count', String(tracksBefore + 1));
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-track-count', String(tracksBefore));
	await toast.getByRole('link', { name: 'Scanning preferences', exact: true }).click();
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await expect(preferences.getByRole('tab', { name: /Effects$/u })).toHaveAttribute('aria-selected', 'true');
	const enabled = preferences.getByRole('checkbox', { name: 'Enable plugin scanning', exact: true });
	await expect(enabled).toBeEnabled();
	await enabled.uncheck();
	await expect(editor.getByRole('region', { name: 'Plugin scan cancelled', exact: true })).toBeVisible();
	await expect.poll(() => page.evaluate(() => globalThis.__soundscaperNativeRuntimeCalls))
		.toEqual(['scan:vst3:system-vst3', 'scan-cancelled']);
	await preferences.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: /^Close$/u }).click();
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	await preferences.getByRole('tab', { name: /Effects$/u }).click();
	await expect(enabled).not.toBeChecked();
});

test('startup scan continues after closing preferences and reports completion', async ({ page }) => {
	await installNativeServicesFixture(page, false, false, true, { startup: true });
	const editor = await bootEditor(page, '/embed/en/');
	const toast = editor.getByRole('region', { name: 'Scanning for plugins', exact: true });
	await toast.getByRole('link', { name: 'Scanning preferences', exact: true }).click();
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await expect(preferences.getByRole('button', { name: 'Scanning', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: /^Close$/u }).click();
	await expect(toast).toBeVisible();
	await page.evaluate(() => globalThis.__completeSoundscaperPluginScan());
	await expect(toast).toContainText('1 of 2 folders scanned');
	await expect.poll(() => page.evaluate(() => globalThis.__soundscaperNativeRuntimeCalls))
		.toEqual(['scan:vst3:system-vst3', 'scan:vst3:custom-vst3']);
	await page.evaluate(() => globalThis.__completeSoundscaperPluginScan());
	await expect(editor.getByRole('region', { name: 'Plugin scan complete', exact: true })).toBeVisible();
});

test('a saved disabled desktop startup setting starts no scan or toast', async ({ page }) => {
	await installNativeServicesFixture(page, false, false, true, { startup: true, disabled: true });
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Effects$/u }).click();
	await expect(preferences.getByRole('checkbox', { name: 'Enable plugin scanning', exact: true })).not.toBeChecked();
	await expect.poll(() => page.evaluate(() => globalThis.__soundscaperNativeRuntimeCalls)).toEqual([]);
	await expect(editor.getByRole('region', { name: 'Scanning for plugins', exact: true })).toHaveCount(0);
});

async function installNativeServicesFixture(page, withPlugins = false, withNativeAudio = false, withPluginFolders = false, startupOptions = {}) {
	await installDesktopSpeedWarmupManifest(page);
	await page.addInitScript(({ includePlugins, includeNativeAudio, includePluginFolders, startup, startupDisabled }) => {
		// The desktop grants microphone access automatically. This host-picker
		// fixture never records; avoid waiting for a browser permission prompt.
		if (includeNativeAudio) Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
			configurable: true, value: async () => new MediaStream(),
		});
		const runtimeCalls = [];
		globalThis.__nativeHostOpenRequests = [];
		let probeCount = 0;
		const unavailablePayload = Object.freeze({
			status: 'unavailable', reason: 'not-built', detail: 'Fixture professional payload is unavailable',
		});
		const audio = Object.freeze({
			enabled: includeNativeAudio, quarantined: false,
			payload: includeNativeAudio
				? Object.freeze({ status: 'available', reason: null, detail: '' }) : unavailablePayload,
			backends: Object.freeze(includeNativeAudio ? ['alsa', 'pipewire'] : []),
		});
		const quarantine = Object.freeze({
			loaded: true, degraded: false, records: Object.freeze([]), pendingFaults: 0,
		});
		let plugins = Object.freeze({
			enabled: startup && !startupDisabled, quarantined: false,
			payload: Object.freeze(includePluginFolders ? { status: 'available', reason: null } : { status: 'unavailable', reason: 'not-built' }),
			formats: Object.freeze([]),
			consent: Object.freeze({ scanningEnabled: false, formats: Object.freeze(includePluginFolders ? [
				{ format: 'vst3', supported: true, granted: startup, roots: [
					{ rootId: 'system-vst3', origin: 'standard', name: 'System VST3 folder', admitted: startup },
					...(startup ? [{ rootId: 'custom-vst3', origin: 'custom', name: 'Custom VST3 folder', admitted: true }] : []),
				] },
				{ format: 'au', supported: false, granted: false, roots: [] },
			] : []) }),
			quarantine,
		});
		let finishScan = null;
		globalThis.__setSoundscaperPluginScanProgress = (progress) => { plugins = { ...plugins, scanProgress: { format: 'vst3', progress } }; };
		globalThis.__completeSoundscaperPluginScan = () => { finishScan?.({ status: 'described', scan: { format: 'vst3', status: 'scanned', detail: '', entries: [] } }); };
		let registry = { entries: includePlugins ? [
			{ entryId: 'echo', format: 'VST3', name: 'Echo', vendor: 'Fixture', eligible: false,
				ineligibleReason: 'Allow this installation before use.', installations: [{ installationId: 'echo-install',
					version: '1.0', allowed: false, selected: true, quarantined: false }] },
			{ entryId: 'gain', format: 'LV2', name: 'Gain', vendor: 'Fixture', eligible: true,
				ineligibleReason: null, installations: [{ installationId: 'gain-install',
					version: '2.0', allowed: true, selected: true, quarantined: false }] },
		] : [] };
		const refused = async (name) => {
			runtimeCalls.push(name);
			throw new Error(`Default-off fixture must not call ${name}.`);
		};
		Object.defineProperty(globalThis, '__soundscaperNativeRuntimeCalls', {
			configurable: true, value: runtimeCalls,
		});
		Object.defineProperty(globalThis, '__soundscaperNativeProbeCount', {
			configurable: true, get: () => probeCount,
		});
		const bridge = Object.freeze({
			getExternalFfmpegStatus: async () => ({ state: 'unconfigured', location: null, version: null, detail: '', canInstall: false, canBrowse: false, canClear: false }),
			getEnvironment: async () => null,
			signalReady: async () => undefined,
			onMenuCommand: () => () => undefined,
			onOpenProject: () => () => undefined,
			onCloseRequested: () => () => undefined,
			onWindowStateChanged: () => () => undefined,
			readNativeTierControls: async () => Object.freeze({
				probeHelperEnabled: false, probeHelperQuarantined: false,
				audioHelperEnabled: false, audioHelperQuarantined: false,
				nativeEffectDiscoveryEnabled: plugins.enabled,
			}),
			applyNativeTierControl: async ({ action, enabled }) => {
				if (!includePluginFolders || action !== 'set-native-effect-discovery-enabled') throw new Error('No fixture tier control is changed.');
				plugins = { ...plugins, enabled };
				if (!enabled && finishScan) {
					runtimeCalls.push('scan-cancelled');
					finishScan({ status: 'failed', code: 'helper-cancelled', message: 'Scan cancelled.' });
				}
				return { probeHelperEnabled: false, probeHelperQuarantined: false,
					audioHelperEnabled: false, audioHelperQuarantined: false, nativeEffectDiscoveryEnabled: enabled };
			},
			nativeAudioHelperAvailability: async () => { probeCount += 1; return audio; },
			setNativeAudioHelperEnabled: async () => includeNativeAudio,
			describeNativeAudioBackend: async ({ backend }) => {
				if (!includeNativeAudio) return refused('describeNativeAudioBackend');
				runtimeCalls.push(`describeNativeAudioBackend:${backend}`);
				return Object.freeze({
					status: 'described',
					inventory: Object.freeze({
						backend, status: 'ready', detail: '',
						devices: Object.freeze([Object.freeze({
							handle: 'studio-interface', label: backend === 'pipewire' ? 'PipeWire interface' : 'Studio interface',
							direction: 'duplex', channelCount: 8, isDefault: false,
						})]),
					}),
				});
			},
			nativePluginAvailability: async () => plugins,
			setNativePluginConsent: async ({ format, action, rootId = '' }) => {
				if (!includePluginFolders) return refused('setNativePluginConsent');
				runtimeCalls.push(`consent:${format}:${action}:${rootId}`);
				const formats = plugins.consent.formats.map((entry) => {
					if (entry.format !== format) return entry;
					if (action === 'grant') return { ...entry, granted: true };
					if (action === 'add-custom-root') return { ...entry, roots: [...entry.roots,
						{ rootId: 'custom-vst3', origin: 'custom', name: 'plugins', displayPath: '/opt/vendor/plugins', admitted: true }] };
					return { ...entry, roots: entry.roots.flatMap((root) => root.rootId !== rootId ? [root]
						: action === 'remove-root' && root.origin === 'custom' ? [] : [{ ...root, admitted: action === 'add-standard-root' }]) };
				});
				plugins = { ...plugins, consent: { formats, scanningEnabled: formats.some((entry) => entry.granted && entry.roots.some((root) => root.admitted)) } };
			},
			scanNativePlugins: async ({ format, rootId }) => {
				if (!includePluginFolders) return refused('scanNativePlugins');
				runtimeCalls.push(`scan:${format}:${rootId}`);
				if (startup) {
					plugins = { ...plugins, scanProgress: { format, progress: null } };
					const result = await new Promise((resolve) => { finishScan = resolve; });
					finishScan = null;
					plugins = { ...plugins, scanProgress: null };
					return result;
				}
				return { status: 'described', scan: { format, status: 'complete', detail: '', entries: [] } };
			},
			listNativePlugins: async () => registry,
			nativePluginScanProgress: async () => ({ enabled: plugins.enabled, scanProgress: plugins.scanProgress }),
			openNativeAudioSession: async (request) => {
				globalThis.__nativeHostOpenRequests.push(request);
				return { status: 'refused', message: 'Fixture audio device is unavailable' };
			},
			bindNativeAudioSession: () => refused('bindNativeAudioSession'),
			nativeAudioSessionStatus: () => refused('nativeAudioSessionStatus'),
			calibrateNativeAudioSession: () => refused('calibrateNativeAudioSession'),
			reportNativeAudioSessionTransfer: () => refused('reportNativeAudioSessionTransfer'),
			reportNativeAudioSessionLoss: () => refused('reportNativeAudioSessionLoss'),
			closeNativeAudioSession: () => refused('closeNativeAudioSession'),
			setNativePluginInstallationAllowed: async ({ installationId, allowed }) => {
				runtimeCalls.push(`allowance:${installationId}:${String(allowed)}`);
				registry = { entries: registry.entries.map((entry) => ({ ...entry,
					installations: entry.installations.map((installation) => installation.installationId === installationId
						? { ...installation, allowed } : installation),
				})) };
				return registry;
			},
			selectNativePluginInstallation: () => refused('selectNativePluginInstallation'),
			instantiateNativePlugin: () => refused('instantiateNativePlugin'),
			runNativePluginOffline: () => refused('runNativePluginOffline'),
			setNativePluginBypassed: () => refused('setNativePluginBypassed'),
			persistNativePluginState: () => refused('persistNativePluginState'),
			restoreNativePluginState: () => refused('restoreNativePluginState'),
			openNativePluginVendorUi: () => refused('openNativePluginVendorUi'),
			closeNativePluginVendorUi: () => refused('closeNativePluginVendorUi'),
			closeNativePluginInstance: () => refused('closeNativePluginInstance'),
		});
		const surface = Object.freeze({ v1: bridge });
		Object.defineProperty(globalThis, 'soundscaperDesktop', { configurable: true, value: surface });
	}, { includePlugins: withPlugins, includeNativeAudio: withNativeAudio, includePluginFolders: withPluginFolders,
		startup: startupOptions.startup === true, startupDisabled: startupOptions.disabled === true });
}
