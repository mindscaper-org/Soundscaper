/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { gappedOpusMp4Fixture } from '../helpers/gapped-opus-mp4-fixture.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

for (const kind of ['ordinary', 'subpacket']) test(`Opus MP4 ${kind} packet gap keeps authored silence and tail through native Save`, async ({ page }) => {
	test.setTimeout(45_000); const { file, reference } = gappedOpusMp4Fixture(kind);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 15_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(entries['project.json']));
	const source = project.sources[0]; expect(source).toMatchObject({ sampleRate: 48000, frameCount: reference.length, channelCount: 1 });
	const pcm = Buffer.from(entries[`audio/${source.id}.f32c`]); let maximumError = 0, tailPeak = 0;
	for (let frame = 0; frame < reference.length; frame++) {
		const value = pcm.readFloatLE(4 + frame * 4); maximumError = Math.max(maximumError, Math.abs(value - reference[frame]));
		if (kind === 'ordinary' && frame >= 6240 && frame < 8640) expect(value).toBe(0);
		if (frame >= reference.length - 1920) tailPeak = Math.max(tailPeak, Math.abs(value));
	}
	expect(maximumError).toBeLessThan(1e-7); expect(tailPeak).toBeGreaterThan(.08);
	await expect(editor.locator('[data-editor-toast="workspace-status-error"]')).toHaveCount(0);
});
