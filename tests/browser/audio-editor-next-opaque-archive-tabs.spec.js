import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, collectClientErrors, downloadBytes, registerAudioEditorHooks, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { rewriteScapeProjectDocument } from '../helpers/scape-archive-rewrite.js';

test.describe('opaque archive tab custody', () => {
	registerAudioEditorHooks();

	test('an open future-version project keeps its exact archive after another project file is opened', async ({ page }) => {
		const store = createProjectStore({ indexedDB: null, preferOpfs: false });
		let future, current;
		try {
			const first = await exportScapeProject(createSoundscaperProject({ id: 'opaque-tab', title: 'Opaque archive tab' }), store);
			const second = await exportScapeProject(createSoundscaperProject({ id: 'current-tab', title: 'Current archive tab' }), store);
			future = await rewriteScapeProjectDocument(first.blob, document => { document.schemaVersion = 2; document.futureOpaqueValue = 'Keep exact bytes'; });
			current = second.blob;
		} finally { await store.close(); }
		// Exercise the browser download route used when the optional native picker is unavailable.
		await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
		const errors = collectClientErrors(page), editor = await bootEditor(page, '/embed/en/');
		await editor.locator('[data-aup4-input]').setInputFiles({ name: 'future.sscape', mimeType: 'application/vnd.soundscaper.scape+zip', buffer: Buffer.from(await future.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-project-id', 'opaque-tab');
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await waitForProjectActivation(editor);
		await editor.locator('[data-aup4-input]').setInputFiles({ name: 'current.sscape', mimeType: 'application/vnd.soundscaper.scape+zip', buffer: Buffer.from(await current.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-project-id', 'current-tab');
		await editor.getByRole('tab', { name: 'Opaque archive tab', exact: true }).click();
		await expect(editor).toHaveAttribute('data-project-id', 'opaque-tab');
		await waitForProjectActivation(editor);
		const download = page.waitForEvent('download', { timeout: 8_000 });
		await chooseExportProjectFileAction(page, editor);
		expect(await downloadBytes(await download)).toEqual(new Uint8Array(await future.arrayBuffer()));
		expect(errors).toEqual([]);
	});
});
