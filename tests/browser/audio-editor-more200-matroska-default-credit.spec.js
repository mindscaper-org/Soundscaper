/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, sourcePeakChannels } from './audio-editor-test-helpers.js';
import { translatedTaggedWebmOpusFixture } from '../helpers/ordinary-ogg-opus-fixture.ts';

for (const nonDefault of [true, false]) test(`Matroska original-language credit excludes translated defaults=${nonDefault}`, async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const file = await translatedTaggedWebmOpusFixture(nonDefault, true);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const peak = await sourcePeakChannels(page, file.name); expect(peak.channelCount).toBe(1);
	expect(peak.channels[0].maximum).toBeGreaterThan(.05);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const panel = editor.locator('[data-workspace-panel="metadata"]');
	await panel.getByRole('tab', { name: 'Attribution', exact: true }).click();
	const attribution = panel.getByRole('tabpanel', { name: 'Attribution', exact: true });
	await attribution.getByText('Imported metadata', { exact: true }).click();
	const field = attribution.locator('dl > div').filter({ has: page.getByText('normalized.artist', { exact: true }) });
	await expect(field.locator('dd')).toHaveText(nonDefault ? 'Default performer' : 'Translated performer; Default performer');
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	const source = document.sources.find(source => source.name === file.name); expect(source.sampleRate).toBe(48_000);
	const contribution = source.provenance.contributions[0]; expect(contribution.warnings).toEqual([]);
	expect(contribution.metadata.normalized.artist).toBe(nonDefault ? 'Default performer' : 'Translated performer; Default performer');
	expect(contribution.metadata.raw.ARTIST).toEqual({ 0: 'Translated performer', 1: 'Default performer' });
	expect(contribution.metadata.normalized.comment).toBe('After credits');
});
