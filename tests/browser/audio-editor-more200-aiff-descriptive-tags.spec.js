/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { pcmTextMetadataCases } from '../helpers/pcm-metadata-import-cases.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, chooseFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

// Each encoding, field budget and image collection is admitted and reopened
// independently in audio-editor-pcm-metadata-custody.test.ts.
test('batched WAV and AIFF imports bind their own Attribution fields and native Save PCM', async ({ page }) => {
	test.setTimeout(60_000);
	const fixtures = await pcmTextMetadataCases();
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles(await Promise.all(fixtures.map(async ({ file }) => ({
		name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()),
	}))));
	await expect(editor).toHaveAttribute('data-clip-count', String(fixtures.length));
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing', { timeout: 30_000 });
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const panel = editor.locator('[data-workspace-panel="metadata"]');
	await panel.getByRole('tab', { name: 'Attribution', exact: true }).click();
	const attribution = panel.getByRole('tabpanel', { name: 'Attribution', exact: true });
	for (const { file, expectedTags } of fixtures) {
		const sourceMetadata = attribution.getByRole('listitem').filter({
			has: page.getByText(file.name, { exact: true }), hasNot: page.getByRole('heading'),
		});
		await expect(sourceMetadata).toHaveCount(1);
		await sourceMetadata.getByText('Imported metadata', { exact: true }).click();
		for (const [key, value] of Object.entries(expectedTags)) {
			const field = sourceMetadata.locator('dl > div').filter({ has: page.getByText(`normalized.${key}`, { exact: true }) });
			await expect(field.locator('dd')).toHaveText(String(value));
		}
	}
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloading));
	const project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources).toHaveLength(fixtures.length);
	for (const { file, expectedTags, expectedPcm, expectedSampleRate, truncated } of fixtures) {
		const source = project.sources.find(source => source.name === file.name);
		expect(source).toMatchObject({ frameCount: expectedPcm[0].length, sampleRate: expectedSampleRate, channelCount: 1 });
		const contribution = source.provenance.contributions[0];
		expect(contribution.metadata.normalized).toMatchObject(expectedTags);
		if (truncated) expect(contribution.warnings.join(' ')).toContain('truncated');
		const pcm = Buffer.from(entries[`audio/${source.id}.f32c`]);
		expect(pcm.readUInt32LE(0)).toBe(expectedPcm[0].length);
		expect(Array.from({ length: expectedPcm[0].length }, (_, frame) => pcm.readFloatLE(4 + frame * 4))).toEqual([...expectedPcm[0]]);
	}
});
