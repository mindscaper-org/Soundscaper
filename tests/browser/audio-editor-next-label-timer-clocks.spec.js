/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const kind of ['timer-frames', 'timer-samples']) test(`${kind} uses its project clock`, async ({ page }) => {
	const project = createSoundscaperProject({ id: `remaining-${kind}`, sampleRate: 44_100,
		sequences: [{ id: 'main', rate: { num: 60, den: 1 }, trackIds: [] }], primarySequenceId: 'main' });
	const native = await exportScapeProject(project, { async getMediaAssetMetadata() { return null; },
		async loadMediaAsset() { return null; }, readSourceChunks() { return (async function* empty() {})(); } });
	const editor = await bootEditor(page, '/embed/en/');
	const chooser = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await chooser).setFiles({ name: 'Clock.sscape', mimeType: 'application/zip', buffer: Buffer.from(await native.blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	await page.getByRole('dialog', { name: 'Record options', exact: true }).getByRole('button', { name: 'Timed recording', exact: true }).click();
	const field = page.getByRole('dialog', { name: 'Set up timed recording', exact: true }).getByRole('group', { name: 'Duration', exact: true });
	const format = field.getByRole('button', { name: 'Duration: format', exact: true });
	await format.click();
	if (kind !== 'timer-samples') {
		await page.getByRole('menuitem', { name: /^Video frames/u }).click();
		await page.getByRole('menuitem', { name: /^hh:mm:ss \+ frames \(/u }).click();
	} else await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	await field.locator('.timecode__display').dblclick();
	await field.getByRole('textbox').fill(kind === 'timer-samples' ? '88200' : '00:00:02:01');
	await field.getByRole('textbox').press('Enter');
	await format.click();
	await page.getByRole('menuitem', { name: 'hh:mm:ss + milliseconds', exact: true }).click();
	await expect(field.locator('.timecode__display')).toHaveText(kind === 'timer-samples' ? '00h00m02.000s' : '00h00m02.017s');
});
