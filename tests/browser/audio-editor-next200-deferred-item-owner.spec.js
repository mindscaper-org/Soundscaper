/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, collectClientErrors,
	disableNativeSavePicker, downloadBytes, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';

for (const transition of ['switch', 'aba', 'same']) {
	test(`a delayed item shortcut stays with its requesting activation: ${transition}`, async ({ page }) => {
		let entered = false;
		let release;
		const held = new Promise(resolve => { release = resolve; });
		await page.route(/\/item-navigation-(?!geometry-)[^/]+\.js$/u, async route => {
			entered = true;
			await held;
			await route.continue();
		});
		const errors = collectClientErrors(page);
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({ name: 'Outgoing.wav', duration: 1 })]);
		const outgoing = editor.locator('[data-clip-id][role="group"]').first();
		await outgoing.focus(); await outgoing.press('Enter');
		await expect(outgoing.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
		try {
			// The playhead delegates the contextual item shortcut to the lazy runtime.
			await editor.getByRole('slider', { name: 'Playhead', exact: true }).press('Control+ArrowRight');
			await expect.poll(() => entered).toBe(true);
			if (transition !== 'same') {
				const oldId = await editor.getAttribute('data-project-id');
				await editor.getByRole('button', { name: 'New project', exact: true }).click();
				await expect(editor).not.toHaveAttribute('data-project-id', oldId);
				if (transition === 'switch') await importFiles(editor, [createWavFixture({ name: 'Incoming.wav', duration: 1 })]);
				else {
					const tabs = editor.getByRole('navigation', { name: 'Project tabs' }).getByRole('tab');
					await expect(tabs).toHaveCount(2); await tabs.first().click();
					await expect(editor).toHaveAttribute('data-project-id', oldId);
					await waitForProjectActivation(editor);
				}
			}
			const clip = editor.locator('[data-clip-id][role="group"]').first();
			const original = await clip.boundingBox(); expect(original).not.toBeNull();
			release();
			if (transition !== 'same') {
				await clip.focus(); await clip.press('Enter');
				await expect(clip.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
				await editor.getByRole('slider', { name: 'Playhead', exact: true }).press('Control+ArrowRight');
			}
			await expect.poll(async () => (await clip.boundingBox()).x - original.x).toBeCloseTo(10, 0);
			await chooseCommandAction(page, editor, 'Edit', 'Undo');
			await expect.poll(async () => (await clip.boundingBox()).x - original.x).toBeCloseTo(0, 0);
			await chooseCommandAction(page, editor, 'Edit', 'Redo');
			await expect.poll(async () => (await clip.boundingBox()).x - original.x).toBeCloseTo(10, 0);
			const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
			const archive = unzipSync(await downloadBytes(await saving));
			const project = JSON.parse(strFromU8(archive['project.json']));
			expect(project.clips).toHaveLength(1);
			expect(project.clips[0].timelineStartFrame).toBe(4000);
			expect(errors).toEqual([]);
		} finally { release(); }
	});
}
