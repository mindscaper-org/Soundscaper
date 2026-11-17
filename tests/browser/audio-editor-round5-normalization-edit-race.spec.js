/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { chooseClipMediaSetting, expectClipGain, setClipGain } from './audio-editor-clip-settings-test-helpers.js';
import { addRackEffect, bootEditor, clipByName, closeDialog, commitInput, disableNativeSavePicker, importFiles, openClipProperties, openExportDialog } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('a later explicit clip gain edit survives an in-progress normalization', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	// The render gate below holds the race open independently of recording length.
	const recording = createWavFixture({ name: 'long-room-tone.wav', frequency: 440,
		duration: 1, channelCount: 1, channelAmplitudes: [0.1] });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [recording]);
	const properties = await openClipProperties(page, editor, clipByName(editor, recording.name));
	await holdNextNativeRender(page);
	try {
		await chooseClipMediaSetting(properties, 'Normalize to −1 dBFS');
		await expect.poll(() => page.evaluate(() => window.__round5NormalizationRenderPending === true)).toBe(true);
		await setClipGain(properties, -6);
		await expectClipGain(properties, -6);
		await page.evaluate(() => window.__round5ReleaseNormalizationRender());
		const exporting = await openExportDialog(page, editor);
		await exporting.getByRole('button', { name: 'Export', exact: true }).click();
		await expect(exporting.locator('[data-export-download]')).toBeVisible({ timeout: 30_000 });
		await closeDialog(exporting);
		await expectClipGain(properties, -6);
	} finally {
		await page.evaluate(() => window.__round5ReleaseNormalizationRender?.());
	}
});

test('a clip rack edit retires normalization measured with the previous Reverb settings', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Rack normalization.wav', frequency: 440, duration: 1, channelCount: 1, channelAmplitudes: [.1] })]);
	const properties = await openClipProperties(page, editor, clipByName(editor, 'Rack normalization.wav'));
	await properties.getByText('Effects', { exact: true }).click();
	await addRackEffect(page, properties, 'track', 'Reverb');
	await closeDialog(page.getByRole('dialog', { name: 'Reverb', exact: true }));
	await page.evaluate(() => {
		const OriginalException = window.DOMException;
		window.__clipNormalizationRetired = false;
		window.DOMException = new Proxy(OriginalException, { construct(target, args) {
			const error = Reflect.construct(target, args);
			if (error.name === 'AbortError' && error.message === 'The clip changed before analysis completed.') window.__clipNormalizationRetired = true;
			return error;
		} });
		window.__restoreNormalizationException = () => { window.DOMException = OriginalException; };
	});
	await holdNextNativeRender(page);
	try {
		await chooseClipMediaSetting(properties, 'Normalize to −1 dBFS');
		await expect.poll(() => page.evaluate(() => window.__round5NormalizationRenderPending === true)).toBe(true);
		await properties.locator('.effect-slot').filter({ hasText: 'Reverb' }).getByRole('button', { name: 'Select effect', exact: true }).click();
		const reverb = page.getByRole('dialog', { name: 'Reverb', exact: true });
		await commitInput(reverb.locator('[data-effect-param="mix"] input'), '.9');
		await closeDialog(reverb);
		await page.evaluate(() => window.__round5ReleaseNormalizationRender());
		const projectId = await editor.getAttribute('data-project-id');
		await expect.poll(async () => {
			const saved = await persistedProject(page, projectId);
			return { gain: saved?.clips?.[0]?.gain, retired: await page.evaluate(() => window.__clipNormalizationRetired === true) };
		}).toEqual({ gain: 1, retired: true });
		await expectClipGain(properties, 0);
	} finally { await page.evaluate(() => { window.__round5ReleaseNormalizationRender?.(); window.__restoreNormalizationException?.(); }); }
});

// Hold the first real browser render's result while the user edits through the
// menu. The race remains explicit even when native rendering finishes quickly.
async function holdNextNativeRender(page) {
	await page.evaluate(() => {
		const prototype = OfflineAudioContext.prototype;
		const startRendering = prototype.startRendering;
		let release;
		const gate = new Promise(resolve => { release = resolve; });
		window.__round5ReleaseNormalizationRender = () => { release(); prototype.startRendering = startRendering; };
		prototype.startRendering = function (...args) {
			prototype.startRendering = startRendering;
			window.__round5NormalizationRenderPending = true;
			return startRendering.apply(this, args).then(async buffer => { await gate; return buffer; });
		};
	});
}
