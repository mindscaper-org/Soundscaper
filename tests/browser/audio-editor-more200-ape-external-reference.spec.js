/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, sourcePeakChannels } from './audio-editor-test-helpers.js';
import { createReferenceWavPackFixture } from '../helpers/wavpack-import-fixture.ts';

for (const type of [2, 0]) test(`WavPack external-reference metadata retains its readable locator type=${type}`, async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const file = await createReferenceWavPackFixture(type);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const peak = await sourcePeakChannels(page, file.name); expect(peak.channelCount).toBe(2);
	expect(peak.channels[0].maximum).toBeGreaterThan(.05);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const panel = editor.locator('[data-workspace-panel="metadata"]');
	await panel.getByRole('tab', { name: 'Attribution', exact: true }).click();
	const attribution = panel.getByRole('tabpanel', { name: 'Attribution', exact: true });
	await attribution.getByText('Imported metadata', { exact: true }).click();
	const field = attribution.locator('dl > div').filter({ has: page.getByText('raw.RELATED', { exact: true }) });
	await expect(field.locator('dd')).toHaveText('https://example.org/credits/Éva');
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	const source = document.sources.find(source => source.name === file.name); expect(source.sampleRate).toBe(48_000);
	const contribution = source.provenance.contributions[0]; expect(contribution.warnings).toEqual([]);
	expect(contribution.metadata.normalized.title).toBe('Referenced performance');
	expect(contribution.metadata.raw.RELATED).toBe('https://example.org/credits/Éva');
	expect(contribution.attachments).toEqual([]);
});
