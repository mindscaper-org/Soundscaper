/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction, disableNativeSavePicker, fileDataTransfer, importFiles, waitForEditor } from './audio-editor-test-helpers.js';
import { editorDatabaseName } from './helpers/editor-databases.js';
import { reaperSession } from '../helpers/reaper-import-fixture.ts';
import { encodeWav } from '../../src/common/editor/wav.js';

for (const [product, path] of [['Soundscaper', '/embed/en/'], ['Framescaper', '/framescaper/embed/en/']]) {
	test(`${product}: REAPER Import, Save, Open and drop preserve audio edits and report losses`, async ({ page }) => {
		await disableNativeSavePicker(page);
		let editor = await bootEditor(page, path, { defaultWorkspace: true });
		const session = { name: 'Podcast.RPP', mimeType: 'text/plain', buffer: Buffer.from(reaperSession().replace('TEMPO 100', 'TEMPO 120')) };
		const media = { name: 'voice.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([new Float32Array(48000).fill(.25)], { sampleRate: 48000, float: true })) };
		await importFiles(editor, [session, media]);
		await expect(editor.getByRole('group', { name: /^Phrase clip,/u })).toHaveCount(1);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await chooseCommandAction(page, editor, 'File', 'Delivery Report');
		let report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
		await expect(report.getByText(/REAPER fade lengths use/u)).toBeVisible();
		await expect(report.getByText(/Referenced media is unavailable/u)).toHaveCount(0);
		await report.getByRole('button', { name: 'Close', exact: true }).last().click();
		await chooseFileAction(page, editor, 'Save project');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const id = await editor.getAttribute('data-project-id');
		await page.reload(); editor = await waitForEditor(page);
		await expect(editor).toHaveAttribute('data-project-id', id);
		const saved = await page.evaluate(({ databaseName, id }) => new Promise((resolve, reject) => {
			const opening = indexedDB.open(databaseName);
			opening.onerror = () => reject(opening.error);
			opening.onsuccess = () => {
				const database = opening.result;
				const request = database.transaction('projects', 'readonly').objectStore('projects').get(id);
				request.onerror = () => { database.close(); reject(request.error); };
				request.onsuccess = () => { database.close(); resolve(request.result); };
			};
		}), { databaseName: editorDatabaseName(product.toLowerCase()), id });
		expect(saved.clips[0].timelineStartFrame).toBe(24000);
		expect(saved.clips[0].sourceStartFrame).toBe(12000);
		expect(saved.clips[0].durationFrames).toBe(24000);
		expect(saved.clips[0].gain).toBe(.25);
		const choosing = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await choosing).setFiles(session);
		await expect(editor).not.toHaveAttribute('data-project-id', id);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await chooseCommandAction(page, editor, 'File', 'Delivery Report');
		report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
		await expect(report.getByText(/Referenced media is unavailable/u)).toBeVisible();
		await report.getByRole('button', { name: 'Close', exact: true }).last().click();
		const previous = await editor.getAttribute('data-project-id');
		const transfer = await fileDataTransfer(page, [session, media]);
		const timeline = editor.getByRole('region', { name: 'Timeline', exact: true }).getByRole('region', { name: 'Timeline', exact: true });
		await timeline.dispatchEvent('dragover', { dataTransfer: transfer });
		await timeline.dispatchEvent('drop', { dataTransfer: transfer });
		await transfer.dispose();
		await expect(editor).not.toHaveAttribute('data-project-id', previous);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
	});
}
