/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction, chooseNestedCommandAction, importFiles, clipByName, disableNativeSavePicker, downloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { readDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';

import { persistedProject } from './helpers/complex-editing-workflows.js';

test('DAWproject nonlinear warning and linear absence retain native fade controls and physical reopen', async ({ page }) => {
	const caseTimeout = test.info().timeout;
	test.setTimeout(caseTimeout * 2);
	let editor;
	for (const [preset, shape, warning] of [['Constant power', 1, true], ['Linear', undefined, false]]) {
		await test.step(preset, async () => {
			if (!editor) {
				await disableNativeSavePicker(page);
				editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
			} else {
				const previousProjectId = await editor.getAttribute('data-project-id');
				await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
				await editor.getByRole('button', { name: 'New project', exact: true }).click();
				await expect(editor).not.toHaveAttribute('data-project-id', previousProjectId);
				await waitForProjectActivation(editor);
				await expect(editor).toHaveAttribute('data-editor-ready', 'true');
				await expect(editor).toHaveAttribute('data-clip-count', '0');
				const projectId = await editor.getAttribute('data-project-id');
				await expect.poll(async () => (await persistedProject(page, projectId))?.sources.length).toBe(0);
			}
			await importFiles(editor, [toneA]);
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
		}, { timeout: caseTimeout });
	}
});
