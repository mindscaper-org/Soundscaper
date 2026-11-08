/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction, chooseNestedCommandAction, importFiles, clipByName, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { readDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';

for (const [preset, shape, warning] of [['Constant power', 1, true], ['Linear', undefined, false], ['S-curve', 2, true]]) {
	test(`DAWproject delivery truthfully reports the ${preset} fade it reopens as linear`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/'); await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name); await clip.focus(); await clip.press('Enter');
		const fade = clip.getByRole('slider', { name: 'Fade in', exact: true });
		for (let count = 0; count < 4; count++) await fade.press('ArrowRight');
		await expect.poll(async () => Number(await fade.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
		await fade.click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Edit fade-in', exact: true }).click();
		const fades = page.getByRole('dialog', { name: 'Fades', exact: true });
		await fades.getByRole('combobox', { name: 'Fade-in shape', exact: true }).selectOption({ label: preset });
		await fades.getByRole('button', { name: 'Apply', exact: true }).click();
		if (shape !== undefined) await expect(clip.getByRole('slider', { name: 'Fade in shape', exact: true })).toHaveAttribute('aria-valuenow', String(shape));
		const downloading = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
		const bytes = await downloadBytes(await downloading);
		const archive = await readDawprojectArchive(new Blob([bytes]));
		try { expect(archive.projectXml).toContain('fadeInTime='); } finally { await archive.close(); }
		await chooseCommandAction(page, editor, 'File', 'Delivery Report');
		const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
		if (warning) await expect(report.locator('[data-delivery-report]')).toContainText('fadeInShape');
		else await expect(report.locator('[data-delivery-report]')).not.toContainText('fadeInShape');
		await report.getByRole('button', { name: 'Close', exact: true }).last().click();
		const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
		await (await choosing).setFiles({ name: 'Fades.dawproject', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
		await expect(editor.locator('[data-status]')).toHaveText('DAWproject imported.');
		const restored = clipByName(editor, toneA.name); await restored.focus(); await restored.press('Enter');
		await expect(restored.getByRole('slider', { name: 'Fade in shape', exact: true })).toHaveAttribute('aria-valuetext', 'Linear');
	});
}
