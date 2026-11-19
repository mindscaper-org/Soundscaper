/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseNestedCommandAction, clipByName, collectClientErrors,
	effectSourceMetadata, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

function voiceFixture(name, colored = false) {
	const file = createWavFixture({ name, duration: 2, channelCount: 1 });
	let seed = 199, previous = 0;
	for (let frame = 0; frame < 96000; frame++) {
		seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
		const value = seed / 2 ** 32 * 12000;
		file.buffer.writeInt16LE(Math.round(colored ? .5 * value + .25 * previous : value), 44 + frame * 2);
		previous = value;
	}
	return file;
}

async function openMatch(page, editor, name) {
	await clipByName(editor, name).locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['EQ and filters', 'Match EQ']);
	return page.locator('[data-selection-effects-dialog]');
}

test.describe('Match EQ and voice profiles', () => {
	registerAudioEditorHooks();
	test('learns, saves and reloads a voice profile, compares a target, edits its curve, and applies with undo', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		const reference = voiceFixture('studio reference.wav'), target = voiceFixture('pickup target.wav', true);
		await importFiles(editor, [reference, target]);
		let dialog = await openMatch(page, editor, reference.name);
		await expect(dialog.getByRole('button', { name: 'Apply to selection', exact: true })).toBeDisabled();
		await dialog.getByRole('button', { name: 'Learn reference from selection', exact: true }).click();
		await expect(dialog.getByRole('status')).toContainText('Reference learned');
		await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Save as new preset', exact: true }).click();
		const prompt = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
		await prompt.getByRole('textbox').fill('My studio voice');
		await prompt.getByRole('button', { name: 'Save preset', exact: true }).click();
		await expect(prompt).toBeHidden();
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		expect(await effectSourceMetadata(page)).toEqual([]);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		await expect(clipByName(editor, target.name)).toBeVisible();
		dialog = await openMatch(page, editor, target.name);
		await dialog.getByRole('button', { name: /^Preset(?::|$)/u }).click();
		await page.getByRole('option', { name: /^My studio voice/u }).click();
		await expect(dialog.getByRole('status')).toContainText('Reference learned');
		await dialog.getByRole('button', { name: 'Analyze target', exact: true }).click();
		await expect(dialog.getByRole('img', { name: 'EQ correction', exact: true })).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Stop preview', exact: true })).toHaveCount(0);
		await chooseDropdown(page, dialog.getByRole('group', { name: 'Preview source', exact: true }), 'Original');
		await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
		await expect(dialog.getByRole('button', { name: 'Stop preview', exact: true })).toBeVisible();
		await dialog.getByRole('button', { name: 'Stop preview', exact: true }).click();
		await chooseDropdown(page, dialog.getByRole('group', { name: 'Preview source', exact: true }), 'Matched (level compensated)');
		await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
		await expect(dialog.getByRole('button', { name: 'Stop preview', exact: true })).toBeVisible();
		await dialog.getByRole('button', { name: 'Stop preview', exact: true }).click();
		await dialog.getByRole('button', { name: 'Edit as Filter Curve EQ', exact: true }).click();
		await expect(dialog.getByRole('group', { name: 'Equalization curve', exact: true })).toBeVisible();
		await expect(dialog.locator('[data-effect-param="points"] circle')).toHaveCount(128);
		await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(dialog).toBeHidden();
		await expect.poll(async () => (await effectSourceMetadata(page)).find(source => source.name.includes('Filter Curve EQ'))?.frameCount).toBe(96000);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(clipByName(editor, target.name)).toHaveCount(1);
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		expect(errors).toEqual([]);
	});

	test('rejects a silent reference and applies Match EQ directly after learning audible audio', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		const silent = voiceFixture('silent reference.wav'); silent.buffer.fill(0, 44);
		const audio = voiceFixture('voice.wav');
		await importFiles(editor, [silent, audio]);
		let dialog = await openMatch(page, editor, silent.name);
		await dialog.getByRole('button', { name: 'Learn reference from selection', exact: true }).click();
		await expect(dialog.getByRole('alert')).toContainText('audible audio');
		expect(await effectSourceMetadata(page)).toEqual([]);
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		dialog = await openMatch(page, editor, audio.name);
		await dialog.getByRole('button', { name: 'Learn reference from selection', exact: true }).click();
		await expect(dialog.getByRole('status')).toContainText('Reference learned');
		await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(dialog).toBeHidden();
		await expect.poll(async () => (await effectSourceMetadata(page)).find(source => source.name.includes('Match EQ'))?.frameCount).toBe(96000);
	});
});
