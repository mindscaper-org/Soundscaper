/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { nativeOpusMp4Fixture } from '../helpers/native-opus-mp4-fixture.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

test('ordinary Opus MP4 File Import and native Save retain unshifted source PCM', async ({ page }) => {
	test.setTimeout(45_000);
	const { file, reference } = nativeOpusMp4Fixture();
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 15_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(entries['project.json']));
	const source = project.sources[0]; expect(source).toMatchObject({ sampleRate: 48000, frameCount: 9600, channelCount: 1 });
	const pcm = Buffer.from(entries[`audio/${source.id}.f32c`]); let maximumError = 0;
	for (let frame = 0; frame < 9600; frame++) maximumError = Math.max(maximumError, Math.abs(pcm.readFloatLE(4 + frame * 4) - reference[frame]));
	expect(maximumError).toBeLessThan(1e-7);
	await expect(editor.locator('[data-editor-toast="workspace-status-error"]')).toHaveCount(0);
});
