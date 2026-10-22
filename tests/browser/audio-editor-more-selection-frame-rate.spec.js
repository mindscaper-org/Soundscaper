/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { exportScapeProject, SCAPE_MIME_TYPE } from '../../src/common/editor/scape-project.js';

registerAudioEditorHooks();

test('selection video-frame editing follows the rate from an opened native project', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	const project = createSoundscaperProject({ id: 'selection-25fps', title: 'PAL programme', primarySequenceId: 'main',
		sequences: [{ id: 'main', rate: { num: 25, den: 1 }, trackIds: [] }] });
	const native = await exportScapeProject(project, { async getMediaAssetMetadata() { return null; },
		async loadMediaAsset() { return null; }, readSourceChunks() { return (async function* empty() {})(); } });
	const editor = await bootEditor(page, '/embed/en/');
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'PAL programme.sscape', mimeType: SCAPE_MIME_TYPE, buffer: Buffer.from(await native.blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await importFiles(editor, [createWavFixture({ name: 'audio.wav', duration: 1, channelCount: 1 })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const end = editor.getByRole('group', { name: 'Selection end', exact: true });
	await end.getByRole('button', { name: 'Selection end: Format', exact: true }).click();
	await page.getByRole('menuitem', { name: /^Video frames/u }).click();
	await page.getByRole('menuitem', { name: /^hh:mm:ss \+ frames \(/u }).click();
	await end.locator('.timecode-digit').last().click();
	await page.keyboard.press('ArrowUp');
	await page.keyboard.press('Enter');
	await end.getByRole('button', { name: 'Selection end: Format', exact: true }).click();
	await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	await expect(end.locator('.timecode__display')).toHaveText('000,000,049,920samples');
});
