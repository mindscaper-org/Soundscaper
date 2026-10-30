/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction, chooseNestedCommandAction, clipByName, closeWorkspacePanel,
	importFiles, openClipProperties, showClipTimingFields } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { expectClipTimeFrames, setClipTimeFrames } from './audio-editor-clip-timing-test-helpers.js';

for (const kind of ['audio', 'generator']) test(`${kind} Properties retains sample-exact timing in its sixty-fps sequence`, async ({ page }) => {
	const editor = await bootEditor(page, kind === 'audio' ? '/embed/en/' : '/framescaper/embed/en/');
	if (kind === 'audio') {
		const project = createSoundscaperProject({ id: 'audio-sixty-fps', sequences: [{ id: 'main', trackIds: [],
			rate: { num: 60, den: 1 } }], primarySequenceId: 'main' });
		const native = await exportScapeProject(project, { async getMediaAssetMetadata() { return null; },
			async loadMediaAsset() { return null; }, readSourceChunks() { return (async function* empty() {})(); } });
		const chooser = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
		await (await chooser).setFiles({ name: 'Audio sixty.sscape', mimeType: 'application/zip', buffer: Buffer.from(await native.blob.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-project-id', project.id);
		await importFiles(editor, [createWavFixture({ name: 'Clock.wav', duration: 3 })]);
	} else {
		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
		const metadata = editor.locator('[data-workspace-panel="metadata"]');
		await metadata.getByRole('tab', { name: 'Sequence timing', exact: true }).click();
		await metadata.getByRole('combobox', { name: 'Frame rate', exact: true }).selectOption('60/1');
		await closeWorkspacePanel(editor, 'metadata');
		await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Title/Text']);
	}
	const clip = kind === 'audio' ? clipByName(editor, 'Clock.wav')
		: editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	const properties = await openClipProperties(page, editor, clip); await showClipTimingFields(properties);
	if (kind === 'audio') {
		await setClipTimeFrames(properties, 'durationFrame', 96_800);
		await closeWorkspacePanel(editor, 'clip-properties');
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await openClipProperties(page, editor, clip);
		await expectClipTimeFrames(properties, 'durationFrame', 144_000);
		return;
	}
	const duration = properties.getByRole('group', { name: 'Duration', exact: true });
	await duration.getByRole('button', { name: 'Duration: format', exact: true }).click();
	await page.getByRole('menuitem', { name: /^Video frames/u }).click();
	await page.getByRole('menuitem', { name: /^hh:mm:ss \+ frames \(/u }).click();
	await duration.locator('.timecode__display').dblclick();
	await duration.getByRole('textbox').fill('00:00:02:01'); await duration.getByRole('textbox').press('Enter');
	await duration.getByRole('button', { name: 'Duration: format', exact: true }).click();
	await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	await expect(duration.locator('.timecode__display')).toHaveText('000,000,096,800samples');
	await closeWorkspacePanel(editor, 'clip-properties'); await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await openClipProperties(page, editor, clip); await showClipTimingFields(properties);
	await expect(properties.getByRole('group', { name: 'Duration', exact: true }).locator('.timecode__display'))
		.toHaveText(kind === 'audio' ? '00h00m03.000s' : '00h00m05.000s');
});
