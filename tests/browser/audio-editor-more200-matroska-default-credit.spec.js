/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, chooseFileAction, disableNativeSavePicker, downloadBytes, sourcePeakChannels } from './audio-editor-test-helpers.js';
import { matroskaMetadataCustodyCases } from '../helpers/matroska-metadata-custody-cases.ts';

// Every tag order, language flag, repeated credit and private key crosses the
// real Opus decoder/controller/store/archive pipeline independently in Node.
// Keep native browser decoding plus source-specific Attribution and Save here.
test('native Matroska decoding and Attribution bind separate recordings through Save', async ({ page }) => {
	test.setTimeout(60_000);
	const selected = new Set(['attachment-true-tags-first-true', 'private-own-keys', 'default-true-flag-last-true']);
	const fixtures = (await matroskaMetadataCustodyCases()).filter(fixture => selected.has(fixture.id)).map(fixture => ({
		...fixture, file: new File([fixture.file], `${fixture.id}.webm`, { type: fixture.file.type }),
	}));
	expect(fixtures).toHaveLength(3);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles(await Promise.all(fixtures.map(async ({ file }) => ({
		name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()),
	}))));
	await expect(editor).toHaveAttribute('data-clip-count', '3', { timeout: 30_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	for (const { file } of fixtures) {
		await expect.poll(async () => (await sourcePeakChannels(page, file.name)).channelCount).toBe(1);
		const peak = await sourcePeakChannels(page, file.name);
		expect(peak.channelCount).toBe(1); expect(peak.channels[0].maximum).toBeGreaterThan(.05);
	}
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const panel = editor.locator('[data-workspace-panel="metadata"]');
	await panel.getByRole('tab', { name: 'Attribution', exact: true }).click();
	const attribution = panel.getByRole('tabpanel', { name: 'Attribution', exact: true });
	const sourceMetadata = attribution.getByRole('listitem').filter({
		has: page.getByText('default-true-flag-last-true.webm', { exact: true }), hasNot: page.getByRole('heading'),
	});
	await expect(sourceMetadata).toHaveCount(1);
	await sourceMetadata.getByText('Imported metadata', { exact: true }).click();
	const artist = sourceMetadata.locator('dl > div').filter({ has: page.getByText('normalized.artist', { exact: true }) });
	await expect(artist.locator('dd')).toHaveText('Default performer');
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const download = await downloading; let entries;
	try { entries = unzipSync(await downloadBytes(download)); } finally { await download.delete(); }
	const project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources).toHaveLength(fixtures.length);
	for (const fixture of fixtures) {
		const source = project.sources.find(source => source.name === fixture.file.name);
		expect(source).toMatchObject({ sampleRate: 48_000, channelCount: 1 }); expect(source.frameCount).toBeGreaterThan(2000);
		const contribution = source.provenance.contributions[0]; expect(contribution.warnings).toEqual([]);
		for (const [key, expected] of Object.entries(fixture.normalized)) expect(contribution.metadata.normalized[key]).toEqual(expected);
		for (const [key, expected] of Object.entries(fixture.raw)) expect(Object.getOwnPropertyDescriptor(contribution.metadata.raw, key)?.value).toEqual(expected);
		if (fixture.attachment) expect(contribution.attachments).toEqual(expect.arrayContaining([expect.objectContaining(fixture.attachment)]));
		const pcm = Buffer.from(entries[`audio/${source.id}.f32c`]); expect(pcm.readUInt32LE(0)).toBe(source.frameCount);
		let maximum = 0;
		for (let frame = 0; frame < source.frameCount; frame++) maximum = Math.max(maximum, Math.abs(pcm.readFloatLE(4 + frame * 4)));
		expect(maximum).toBeGreaterThan(.05);
	}
});
