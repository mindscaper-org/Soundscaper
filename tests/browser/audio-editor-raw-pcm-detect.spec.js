/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

test('Detect estimates raw PCM settings and imports the reviewed stereo audio', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Import raw data');
	const dialog = page.getByRole('dialog', { name: 'Import raw data', exact: true });
	const detect = dialog.getByRole('button', { name: 'Detect', exact: true });
	await expect(detect).toBeDisabled();
	const frames = 4096;
	const buffer = Buffer.alloc(4 + frames * 6);
	const sample = (frame, channel) => Math.round(Math.sin(frame * (channel ? .091 : .057) + channel) * 4_000_000);
	for (let frame = 0; frame < frames; frame++) {
		for (let channel = 0; channel < 2; channel++) buffer.writeIntBE(sample(frame, channel), 4 + frame * 6 + channel * 3, 3);
	}
	await dialog.getByLabel('Raw PCM file').setInputFiles({ name: 'stereo.raw', mimeType: 'application/octet-stream', buffer });
	await dialog.getByRole('spinbutton', { name: 'Sample rate', exact: true }).fill('48000');
	await dialog.getByRole('spinbutton', { name: 'Byte offset', exact: true }).fill('4');
	await detect.click();
	await expect(dialog.getByRole('status')).toHaveText('Estimated format applied. Review the settings before importing.');
	await expect(dialog.getByRole('combobox', { name: 'Sample format', exact: true })).toHaveValue('int24');
	await expect(dialog.getByRole('combobox', { name: 'Byte order', exact: true })).toHaveValue('big');
	await expect(dialog.getByRole('spinbutton', { name: 'Channels', exact: true })).toHaveValue('2');
	await expect(dialog.getByRole('spinbutton', { name: 'Sample rate', exact: true })).toHaveValue('48000');
	await expect(dialog.getByRole('spinbutton', { name: 'Byte offset', exact: true })).toHaveValue('4');
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	await dialog.getByRole('button', { name: 'Import', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const pending = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const archive = unzipSync(await downloadBytes(await pending));
	const project = JSON.parse(strFromU8(archive['project.json']));
	const source = project.sources[0];
	expect(source).toMatchObject({ sampleRate: 48000, frameCount: frames, channelCount: 2 });
	const pcm = Buffer.from(archive[`audio/${source.id}.f32c`]);
	expect(pcm.readUInt32LE(0)).toBe(frames);
	for (const frame of [0, 100, 2000, 4095]) {
		for (let channel = 0; channel < 2; channel++) {
			expect(pcm.readFloatLE(4 + (channel * frames + frame) * 4)).toBeCloseTo(sample(frame, channel) / 8388608, 6);
		}
	}
});

test('Detect keeps manual settings when raw PCM is silent', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Import raw data');
	const dialog = page.getByRole('dialog', { name: 'Import raw data', exact: true });
	await dialog.getByLabel('Raw PCM file').setInputFiles({ name: 'silence.raw', mimeType: 'application/octet-stream', buffer: Buffer.alloc(4096) });
	await dialog.getByRole('button', { name: 'Detect', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Could not detect the format. Choose the settings manually.');
	await expect(dialog.getByRole('combobox', { name: 'Sample format', exact: true })).toHaveValue('int16');
	await expect(dialog.getByRole('combobox', { name: 'Byte order', exact: true })).toHaveValue('little');
	await expect(dialog.getByRole('spinbutton', { name: 'Channels', exact: true })).toHaveValue('1');
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(editor).toHaveAttribute('data-clip-count', '0');
});
