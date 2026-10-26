/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { riffInfoLengthFixture } from '../helpers/riff-info-length-fixtures.ts';

for (const long of [false, true]) test(`File Import and Save retain WAV credits beside a long comment (${long})`, async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const original = Buffer.from(riffInfoLengthFixture(long));
	await importFiles(editor, [{ name: 'Production notes.wav', mimeType: 'audio/wav', buffer: original }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const panel = editor.locator('[data-workspace-panel="metadata"]');
	await panel.getByRole('tab', { name: 'Attribution', exact: true }).click();
	const attribution = panel.getByRole('tabpanel', { name: 'Attribution', exact: true });
	await attribution.getByText('Imported metadata', { exact: true }).click();
	const artist = attribution.locator('dl > div').filter({ has: page.getByText('normalized.artist', { exact: true }) });
	await expect(artist.locator('dd')).toHaveText('Small independent credit');
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloading)); const project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources).toHaveLength(1); expect(project.sources[0]).toMatchObject({ sampleRate: 48_000, frameCount: 4800, channelCount: 1 });
	const provenance = project.sources[0].provenance.contributions[0];
	expect(provenance.metadata.normalized).toMatchObject({ artist: 'Small independent credit', title: 'Harbour voices', comment: 'x'.repeat(long ? 65_536 : 100) });
	if (long) expect(provenance.warnings.join(' ')).toContain('truncated');
	let offset = 12;
	while (original.toString('ascii', offset, offset + 4) !== 'data') {
		const size = original.readUInt32LE(offset + 4); offset += 8 + size + size % 2;
	}
	const [, payload] = Object.entries(entries).find(([name]) => name.endsWith('.f32c')); const pcm = Buffer.from(payload);
	expect(pcm.readUInt32LE(0)).toBe(4800);
	expect(Array.from({ length: 4800 }, (_, frame) => pcm.readFloatLE(4 + frame * 4)))
		.toEqual(Array.from({ length: 4800 }, (_, frame) => original.readInt16LE(offset + 8 + frame * 2) / 32768));
});
