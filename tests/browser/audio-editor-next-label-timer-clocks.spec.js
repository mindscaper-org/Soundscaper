/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseCommandAction } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const kind of ['label', 'timer-frames', 'timer-samples']) test(`${kind} uses its project and owning sequence clocks`, async ({ page }) => {
	const isLabel = kind === 'label';
	const project = createSoundscaperProject({ id: `remaining-${kind}`, sampleRate: isLabel ? 48_000 : 44_100,
		tracks: isLabel ? [{ id: 'labels', type: 'label', name: 'Cues', labels: [{ id: 'cue', title: 'Speech', startFrame: 0, endFrame: 144_000 }] }] : [],
		sequences: [{ id: 'main', rate: { num: 60, den: 1 }, trackIds: [] },
			...(isLabel ? [{ id: 'cut', rate: { num: 120, den: 1 }, trackIds: ['labels'] }] : [])], primarySequenceId: 'main' });
	const native = await exportScapeProject(project, { async getMediaAssetMetadata() { return null; },
		async loadMediaAsset() { return null; }, readSourceChunks() { return (async function* empty() {})(); } });
	const editor = await bootEditor(page, '/embed/en/');
	const chooser = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await chooser).setFiles({ name: 'Clock.sscape', mimeType: 'application/zip', buffer: Buffer.from(await native.blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	let field;
	if (isLabel) {
		await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
		field = editor.locator('[data-workspace-panel="labels"] .audio-editor-timecode-input').last();
	} else {
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		await page.getByRole('dialog', { name: 'Record options', exact: true }).getByRole('button', { name: 'Timed recording', exact: true }).click();
		field = page.getByRole('dialog', { name: 'Set up timed recording', exact: true }).locator('.audio-editor-timecode-input');
	}
	await field.locator('.timecode__format-button').click();
	if (kind !== 'timer-samples') {
		await page.getByRole('menuitem', { name: /^Video frames/u }).click();
		await page.getByRole('menuitem', { name: /^hh:mm:ss \+ frames \(/u }).click();
	} else await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	await field.locator('.timecode__display').dblclick();
	await field.getByRole('textbox').fill(kind === 'timer-samples' ? '88200' : '00:00:02:01');
	await field.getByRole('textbox').press('Enter');
	if (isLabel) {
		await field.locator('.timecode__format-button').click();
		await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
		await expect(field.locator('.timecode__display')).toHaveText('000,000,096,400samples');
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(field.locator('.timecode__display')).toHaveText('000,000,144,000samples');
	} else await expect(field.locator('[data-timecode-direct-entry]')).toHaveValue(kind === 'timer-samples' ? '2' : String(2 + 1 / 60));
});
