/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, openNestedCommandMenu, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { installNativePluginParameterHost } from './helpers/native-plugin-parameter-host.js';

test('Effect > JUCE lists the catalogue and selects Chorus for native insertion and controls', async ({ page }) => {
	await installNativePluginParameterHost(page, { vendorUi: true, pluginName: 'JUCE Chorus',
		stablePluginId: 'org.soundscaper.juce.chorus', parameterCount: 6 });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'chorus-source.wav', duration: 1, channelCount: 2 })]);
	const menu = await openNestedCommandMenu(page, editor, 'Effect', ['JUCE']);
	await expect(menu.getByRole('menuitem')).toHaveCount(18);
	for (const label of ['Gain', 'Convolution Reverb', 'Reverb', 'Chorus', 'Phaser', 'Compressor', 'Noise Gate',
		'Limiter', 'Ladder Filter', 'Delay', 'Waveshaper', 'Panner', 'Bias', 'IIR Filter', 'FIR Filter',
		'State Variable Filter', 'First Order Filter', 'Linkwitz-Riley Filter']) {
		await expect(menu.getByRole('menuitem', { name: label, exact: true })).toBeEnabled();
	}
	await menu.getByRole('menuitem', { name: 'Chorus', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Plugin Manager', exact: true });
	await expect(dialog.getByRole('heading', { name: 'JUCE Chorus', exact: true })).toBeVisible();
	await dialog.locator('[data-native-plugin-instantiate="gain-install"]').click();
	await expect(dialog.getByRole('slider')).toHaveCount(6);
	const parameter = dialog.getByRole('slider').first();
	await parameter.press('End');
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.values[0])).toBe(1);
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(dialog).toBeHidden();
	// A second menu insertion gets fresh controls without closing the authored rack instance.
	await chooseNestedCommandAction(page, editor, 'Effect', ['JUCE', 'Chorus']);
	await expect(dialog.getByRole('heading', { name: 'JUCE Chorus', exact: true })).toBeVisible();
	await expect(dialog.locator('[data-native-plugin-instantiate="gain-install"]')).toBeEnabled();
});
