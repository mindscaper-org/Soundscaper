/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { strFromU8, unzipSync } from 'fflate';

test('Selection toolbar only offers value entry while it has an operable range', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [createWavFixture({ name: 'selection-value.wav', frequency: 440, duration: 2, channelCount: 1 })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const start = editor.getByRole('group', { name: 'Selection start', exact: true });
	const end = editor.getByRole('group', { name: 'Selection end', exact: true });
	const enterEnd = async text => {
		await expect(end).toHaveAttribute('aria-disabled', 'false');
		await end.dblclick();
		const input = end.getByRole('textbox');
		await input.fill(text); await input.press('Enter');
	};
	await enterEnd('00:00:01.000');
	let saved = await exportProject(page, editor);
	expect(saved.selection.endFrame).toBe(48_000);

	await chooseCommandAction(page, editor, 'Select', 'Select none');
	for (const endpoint of [start, end]) {
		await expect(endpoint).toHaveAttribute('aria-disabled', 'true');
		const box = await endpoint.boundingBox();
		if (!box) throw new Error('Expected the displayed selection endpoint.');
		// Native mouse input checks the real disabled behavior, independently of
		// Playwright's semantic refusal to locator-click aria-disabled controls.
		await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
		await expect(endpoint.getByRole('textbox')).toHaveCount(0);
	}
	const duration = editor.getByRole('group', { name: 'Selection duration', exact: true });
	await duration.getByRole('button', { name: 'Selection duration: Format', exact: true }).click();
	await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	await expect(duration).toHaveAttribute('aria-disabled', 'false');
	saved = await exportProject(page, editor);
	expect(saved.selection.startFrame).toBe(0); expect(saved.selection.endFrame).toBe(0);

	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await enterEnd('00:00:00.500');
	saved = await exportProject(page, editor);
	expect(saved.selection.endFrame).toBe(24_000);
});

async function exportProject(page, editor) {
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	return JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
}
