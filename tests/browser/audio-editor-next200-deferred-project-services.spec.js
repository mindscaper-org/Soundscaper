/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker, importFiles, openExportDialog } from './audio-editor-test-helpers.js';

for (const kind of ['analysis', 'export']) for (const change of [true, false]) {
	test(`cold ${kind} work keeps its invoked project: change=${change}`, async ({ page }) => {
		let entered = false, release;
		const held = new Promise(resolve => { release = resolve; });
		await page.addInitScript(() => { globalThis.__coldServiceEntries = []; });
		const factory = kind === 'analysis' ? 'createAudioAnalysisService' : 'createEditorExportService';
		await page.route(new RegExp(`/${kind}-service-[^/]+\\.js$`, 'u'), async route => {
			const response = await route.fetch(), body = await response.text();
			const match = body.match(new RegExp(`([\\w$]+)\\s+as\\s+${factory}`, 'u')); expect(match).not.toBeNull();
			const method = kind === 'analysis' ? 'findClipping' : 'handleExportAction';
			const observed = body.replace(match[0], `observedFactory as ${factory}`)
				+ `\nconst observedFactory=(...ports)=>{const service=${match[1]}(...ports);return {...service,async ${method}(...args){if(args[0]!=='cancel')globalThis.__coldServiceEntries.push(ports[0].getProject()?.id);return await service.${method}(...args);}}};`;
			entered = true; await held; await route.fulfill({ response, body: observed });
		});
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({ name: 'Outgoing.wav', duration: .1 })]);
		async function begin() {
			if (kind === 'analysis') {
				await chooseCommandAction(page, editor, 'Analyze', 'Find clipping');
				return page.getByRole('dialog', { name: 'Find clipping', exact: true });
			}
			const dialog = await openExportDialog(page, editor);
			await dialog.getByRole('button', { name: 'Export', exact: true }).click();
			return dialog;
		}
		try {
			let dialog = await begin(); await expect.poll(() => entered).toBe(true);
			if (change) {
				await dialog.getByRole('button', { name: kind === 'analysis' ? 'Close' : 'Cancel', exact: true }).click();
				await expect(dialog).toBeHidden();
				const oldId = await editor.getAttribute('data-project-id');
				await editor.getByRole('button', { name: 'New project', exact: true }).click();
				await expect(editor).not.toHaveAttribute('data-project-id', oldId);
				await importFiles(editor, [createWavFixture({ name: 'Incoming.wav', duration: .2 })]);
				dialog = await begin();
			}
			release();
			if (kind === 'analysis') await expect(dialog.locator('[data-analysis-report="clipping"]')).toBeVisible();
			else await expect(dialog.locator('[data-export-download]')).toHaveAttribute('href', /^blob:/u);
			expect(await page.evaluate(() => globalThis.__coldServiceEntries)).toEqual([await editor.getAttribute('data-project-id')]);
		} finally { release(); }
	});
}
