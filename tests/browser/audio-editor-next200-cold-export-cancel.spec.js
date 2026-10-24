/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';

for (const mode of ['cancel cold', 'keep cold', 'cancel completed']) {
	test(`same-project Export Cancel retires its submitted request: ${mode}`, async ({ page }) => {
		let entered = false, release;
		const held = new Promise(resolve => { release = resolve; });
		await page.addInitScript(() => { globalThis.__coldExportStarts = []; });
		await page.route(/\/export-service-[^/]+\.js$/u, async route => {
			const response = await route.fetch(), body = await response.text();
			const match = body.match(/([\w$]+)\s+as\s+createEditorExportService/u); expect(match).not.toBeNull();
			const observed = body.replace(match[0], 'observedFactory as createEditorExportService')
				+ `\nconst observedFactory=(...ports)=>{const service=${match[1]}(...ports);return {...service,async handleExportAction(...args){if(args[0]!=='cancel')globalThis.__coldExportStarts.push(ports[0].getProject()?.id);return await service.handleExportAction(...args);}}};`;
			entered = true; await held; await route.fulfill({ response, body: observed });
		});
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({ name: 'Recording.wav', duration: .1 })]);
		const projectId = await editor.getAttribute('data-project-id');
		try {
			let dialog = await openExportDialog(page, editor);
			await dialog.getByRole('button', { name: 'Export', exact: true }).click();
			await expect.poll(() => entered).toBe(true);
			if (mode === 'cancel completed') {
				release();
				await expect(dialog.locator('[data-export-download]')).toHaveAttribute('href', /^blob:/u);
			}
			let previous = null;
			if (mode !== 'keep cold') {
				await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(dialog).toBeHidden();
				dialog = await openExportDialog(page, editor);
				previous = await dialog.locator('[data-export-download]').getAttribute('href');
				await dialog.getByRole('button', { name: 'Export', exact: true }).click();
			}
			release();
			const link = dialog.locator('[data-export-download]');
			await expect(link).toBeVisible(); await expect(link).toHaveAttribute('href', /^blob:/u);
			if (previous) await expect(link).not.toHaveAttribute('href', previous);
			const descriptor = await inspectWavBlobPcm(new Blob([await readDownloadBytes(page, link)]));
			expect(descriptor).toMatchObject({ sampleRate: 48_000, frameCount: 4800, channelCount: 2 });
			await expect(editor).toHaveAttribute('data-project-id', projectId);
			expect(await page.evaluate(() => globalThis.__coldExportStarts)).toEqual(Array(mode === 'cancel completed' ? 2 : 1).fill(projectId));
		} finally { release(); }
	});
}
