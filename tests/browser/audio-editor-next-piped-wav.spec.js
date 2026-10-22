/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { createRiffBextChunk } from '../../src/common/editor/broadcast-wave.ts';
import { createRiffInfoChunk } from '../../src/common/editor/riff-info.ts';

test('File Import retains recorder BEXT from a WAV captured through an unseekable pipe', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const file = createWavFixture({ name: 'piped recording.wav', sampleRate: 48_000, duration: .1, channelCount: 1, frequency: 440, channelAmplitudes: [.25] });
	const bytes = Uint8Array.from(Buffer.concat([file.buffer.subarray(0, 36),
		createRiffBextChunk({ description: 'Pipe microphone take', originator: 'Field recorder' }),
		createRiffInfoChunk({ title: 'Piped title', artist: 'Alice' }), file.buffer.subarray(36)]));
	const view = new DataView(bytes.buffer);
	view.setUint32(4, 0xffff_ffff, true);
	let offset = 12;
	while (String.fromCharCode(...bytes.subarray(offset, offset + 4)) !== 'data') offset += 8 + view.getUint32(offset + 4, true) + (view.getUint32(offset + 4, true) & 1);
	view.setUint32(offset + 4, 0xffff_ffff, true);
	await importFiles(editor, [{ ...file, buffer: Buffer.from(bytes) }]);
	await expect(clipByName(editor, file.name)).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const panel = editor.locator('[data-workspace-panel="metadata"]');
	await panel.getByRole('tab', { name: 'BEXT', exact: true }).click();
	await expect(panel.locator('input[name="description"]')).toHaveValue('Pipe microphone take');
});
