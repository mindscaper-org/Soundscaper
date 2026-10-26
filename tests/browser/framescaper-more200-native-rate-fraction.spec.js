/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { installDesktopSpeedWarmupManifest } from './helpers/desktop-speed-warmup-fixture.js';

test('Image sequence accepts equivalent exact frame-rate fractions before opening the native chooser', async ({ page }) => {
	await installDesktopSpeedWarmupManifest(page);
	await page.addInitScript(() => {
		globalThis.__rateChoosers = 0;
		const nativeServices = {
			snapshot: async () => ({ snapshotVersion: 1, runtimeAvailable: true, nativeMediaEnabled: true, queue: [], roots: [], watchRules: [] }),
			control: async () => ({}), reorder: async () => [], remove: async () => true,
			preferences: async () => ({ nativeMediaEnabled: true, hardwareDecodeEnabled: false, hardwareEncodeEnabled: false, ofxConsentEnabled: false }),
			capabilities: async () => ({ snapshotVersion: 1, masterEnabled: true, buildFingerprint: null,
				entries: [{ domain: 'operation', id: 'image-sequence-import', state: 'available', reason: 'ready', userEnabled: true, buildFingerprint: null, detail: null }] }),
			selectImageSequence: async () => { globalThis.__rateChoosers++; return null; },
			readImageSequenceFile: async () => { throw new Error('Cancelled picker must not read'); },
			releaseImageSequence: async () => true,
			imageSequenceImport: async () => { throw new Error('Cancelled picker must not publish'); },
			writeImageSequenceImportChunk: async () => { throw new Error('Cancelled picker must not write'); },
			readImageSequenceImportBody: async () => { throw new Error('Cancelled picker must not read'); },
		};
		Object.defineProperty(globalThis, 'framescaperDesktop', { configurable: true, enumerable: true, value: Object.freeze({ v1: Object.freeze({
			nativeServices: Object.freeze(nativeServices),
			getExternalFfmpegStatus: async () => ({ state: 'unconfigured', location: null, version: null, detail: '', canInstall: false, canBrowse: false, canClear: false }),
			applyNativeTierControl: async () => ({ probeHelperEnabled: false, probeHelperQuarantined: false, audioHelperEnabled: false, audioHelperQuarantined: false, nativeEffectDiscoveryEnabled: false }),
			readNativeTierControls: async () => ({ probeHelperEnabled: false, probeHelperQuarantined: false, audioHelperEnabled: false, audioHelperQuarantined: false, nativeEffectDiscoveryEnabled: false }),
		}) }) });
	});
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseCommandAction(page, editor, 'File', 'Image sequence');
	const dialog = page.getByRole('dialog', { name: 'Image sequence', exact: true });
	const action = dialog.getByRole('button', { name: 'Continue', exact: true });
	await action.click();
	await expect.poll(() => page.evaluate(() => globalThis.__rateChoosers)).toBe(1);
	await expect(action).toBeEnabled();
	await dialog.getByRole('spinbutton', { name: 'Frame rate numerator', exact: true }).fill('48');
	await dialog.getByRole('spinbutton', { name: 'Frame rate denominator', exact: true }).fill('2');
	await action.click();
	await expect.poll(() => page.evaluate(() => globalThis.__rateChoosers)).toBe(2);
	await expect(action).toBeEnabled();
	await expect(dialog).not.toContainText(/must be an exact reduced rational/u);
	await expect(editor).toHaveAttribute('data-clip-count', '0');
});
