/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { createPaddedMetadataWavPackFixture } from '../helpers/wavpack-import-fixture.ts';

for (const [padding, retainTag] of [[0, true], [16, true], [4096, true], [4096, false]]) test(`File Import retains WavPack PCM after tag edit padding=${padding}, tag=${retainTag}`, async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/'); const file = await createPaddedMetadataWavPackFixture(padding, retainTag);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloading)); const project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources).toHaveLength(1); const source = project.sources[0]; expect(source).toMatchObject({ sampleRate: 48_000, frameCount: 4800, channelCount: 2 });
	const contribution = source.provenance.contributions[0];
	expect(contribution.warnings).toEqual([]);
	expect(contribution.metadata.normalized?.title).toBe(retainTag ? 'Shorter edited metadata' : undefined);
	const [, payload] = Object.entries(entries).find(([name]) => name.endsWith('.f32c')); const pcm = Buffer.from(payload);
	expect(pcm.readUInt32LE(0)).toBe(4800);
	for (let frame = 0; frame < 4800; frame++) {
		expect(Math.abs(pcm.readFloatLE(4 + frame * 4) - Math.fround(Math.sin(frame * .1) * .2))).toBeLessThan(1e-7);
		expect(Math.abs(pcm.readFloatLE(4 + (4800 + frame) * 4) - Math.fround(Math.cos(frame * .03) * .1))).toBeLessThan(1e-7);
	}
});
