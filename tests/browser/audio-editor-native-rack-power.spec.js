/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { openEffectsForTrack } from './audio-editor-test-helpers.js';
import { openInstalledGain } from './helpers/native-plugin-parameter-host.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('a native effect header can re-enable an effect disabled in its rack', async ({ page }) => {
	const manager = await openInstalledGain(page, { allowBypass: true });
	await manager.getByRole('button', { name: 'Close', exact: true }).last().click();
	const editor = page.locator('[data-audio-editor]');
	const id = await editor.getAttribute('data-project-id');
	await expect.poll(async () => (await persistedProject(page, id)).tracks.findIndex(track => track.effects.some(effect => effect.type === 'native-plugin'))).toBeGreaterThanOrEqual(0);
	const project = await persistedProject(page, id);
	const index = project.tracks.findIndex(track => track.effects.some(effect => effect.type === 'native-plugin'));
	const panel = await openEffectsForTrack(editor, index);
	const slot = panel.locator('.effect-slot').first();
	await slot.getByRole('button', { name: 'Disable effect', exact: true }).click();
	await expect(slot.getByRole('button', { name: 'Enable effect', exact: true })).toBeVisible();
	await expect.poll(async () => (await persistedProject(page, id)).tracks[index].effects[0].bypassed).toBe(true);
	await slot.locator('.effect-slot__name-field').click();
	const settings = page.locator('.audio-editor-effect-settings-dialog');
	await expect(settings.getByRole('button', { name: 'Enable effect', exact: true })).toBeVisible();
	await settings.getByRole('button', { name: 'Enable effect', exact: true }).click();
	await expect(slot.getByRole('button', { name: 'Disable effect', exact: true })).toBeVisible();
	await expect.poll(async () => (await persistedProject(page, id)).tracks[index].effects[0].bypassed).toBe(false);
	await settings.getByRole('button', { name: 'Disable effect', exact: true }).click();
	await expect(slot.getByRole('button', { name: 'Enable effect', exact: true })).toBeVisible();
	await expect.poll(async () => (await persistedProject(page, id)).tracks[index].effects[0].bypassed).toBe(true);
	await settings.getByRole('button', { name: 'Close', exact: true }).click();
	await slot.getByRole('button', { name: 'Enable effect', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.bypassed)).toBe(false);
	await expect.poll(async () => (await persistedProject(page, id)).tracks[index].effects[0].bypassed).toBe(false);
});
