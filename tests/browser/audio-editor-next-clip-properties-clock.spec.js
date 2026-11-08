/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction, chooseNestedCommandAction, clipByName, closeWorkspacePanel,
	clipField, commitInput, importFiles, openClipProperties, showClipTimingFields } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const kind of ['audio', 'generator']) test(kind === 'audio'
	? 'audio Properties numeric duration preserves its authored sixty-fps interval'
	: 'generator Properties frame format retains its selected sixty-fps clock', async ({ page }) => {
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
		const duration = clipField(properties, 'durationFrame');
		await commitInput(duration, String(121 / 60));
		await expect.poll(async () => {
			const saved = await persistedProject(page, 'audio-sixty-fps');
			return { rate: saved?.sequences.find(sequence => sequence.id === saved.primarySequenceId)?.rate,
				frames: saved?.clips[0]?.durationFrames };
		}).toEqual({ rate: { num: 60, den: 1 }, frames: 96_800 });
		await duration.focus(); await expect(duration).toHaveValue(String(121 / 60)); await duration.blur();
	} else {
		const duration = properties.getByRole('group', { name: 'Duration', exact: true });
		await duration.getByRole('button', { name: 'Duration: format', exact: true }).click();
		await page.getByRole('menuitem', { name: /^Video frames/u }).click();
		await page.getByRole('menuitem', { name: /^hh:mm:ss \+ frames \(/u }).click();
		await duration.locator('.timecode__display').dblclick();
		await duration.getByRole('textbox').fill('00:00:02:01'); await duration.getByRole('textbox').press('Enter');
		await duration.getByRole('button', { name: 'Duration: format', exact: true }).click();
		await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
		await expect(duration.locator('.timecode__display')).toHaveText('000,000,096,800samples');
	}
	await closeWorkspacePanel(editor, 'clip-properties'); await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await openClipProperties(page, editor, clip); await showClipTimingFields(properties);
	if (kind === 'audio') {
		await expect(clipField(properties, 'durationFrame')).toHaveValue('3');
		await expect.poll(async () => (await persistedProject(page, 'audio-sixty-fps'))?.clips[0]?.durationFrames).toBe(144_000);
	} else await expect(properties.getByRole('group', { name: 'Duration', exact: true }).locator('.timecode__display'))
		.toHaveText('00h00m05.000s');
});
