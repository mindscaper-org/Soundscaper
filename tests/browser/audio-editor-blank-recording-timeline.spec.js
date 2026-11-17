/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, chooseExportProjectFileAction, chooseFileAction,
	collectClientErrors, disableNativeSavePicker, downloadBytes, registerAudioEditorHooks, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone, persistedProject } from './helpers/complex-editing-workflows.js';

registerAudioEditorHooks();

test('an LP recording keeps its moving cursor visible in minutes of blank timeline beyond backing playback', async ({ page }) => {
	test.setTimeout(90_000);
	await installOscillatorMicrophone(page);
	await disableNativeSavePicker(page);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Zoom out']);
	for (let step = 1; step < 10; step++) await editor.getByRole('button', { name: 'Zoom out', exact: true }).click();
	const panel = editor.locator('.audio-editor-timeline-panel');
	const readX = () => panel.evaluate(node => Number.parseFloat(node.style.getPropertyValue('--timeline-playhead-x')));
	const origin = await readX();
	const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
	await record.click();
	try {
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		const playhead = editor.locator('[data-playhead]');
		await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow')), { timeout: 45_000 })
			.toBeGreaterThan(32 * 48_000);
		const afterBackingEnd = await readX();
		await expect.poll(readX).toBeGreaterThan(afterBackingEnd + 0.1);
		const recordedSeconds = Number(await playhead.getAttribute('aria-valuenow')) / 48_000;
		const viewportWidth = await panel.evaluate(node => Number.parseFloat(node.style.getPropertyValue('--timeline-viewport-width')));
		const drawnX = await readX();
		expect(recordedSeconds * viewportWidth / (drawnX - origin)).toBeGreaterThan(40 * 60);
		expect(drawnX - origin).toBeLessThan(viewportWidth);
	} finally {
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	}
	await expect(record).toHaveAttribute('aria-pressed', 'false', { timeout: 20_000 });
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 20_000 });
	const saved = await persistedProject(page, await editor.getAttribute('data-project-id'));
	expect(saved.clips.reduce((frames, clip) => frames + clip.durationFrames, 0)).toBeGreaterThan(32 * 48_000);
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const download = await downloading;
	const archive = await downloadBytes(download);
	await download.delete();
	await chooseFileAction(page, editor, 'New');
	await expect(editor).not.toHaveAttribute('data-project-id', saved.id);
	await waitForProjectActivation(editor);
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'LP side A.sscape', mimeType: 'application/zip', buffer: Buffer.from(archive) });
	await expect(editor).toHaveAttribute('data-project-id', saved.id, { timeout: 20_000 });
	await expect(page.getByRole('dialog', { name: 'Project already exists', exact: true })).toBeHidden();
	expect(errors).toEqual([]);
});
