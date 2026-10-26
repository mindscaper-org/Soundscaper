/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, fileDataTransfer, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { legacyAupFiles } from '../helpers/more200-legacy-aup-file.ts';

for (const sampleRate of [48_000, 44_100]) test(`dropping a legacy ${String(sampleRate)}Hz project and recording imports both into the incoming document`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Outgoing.wav', duration: .2, frequency: 220, channelCount: 1 })]);
	const outgoingId = await editor.getAttribute('data-project-id');
	const { projectFile, dataFile } = legacyAupFiles('utf-8');
	const xml = (await projectFile.text()).replaceAll('rate="48000"', `rate="${String(sampleRate)}"`);
	const block = await dataFile.arrayBuffer(); new DataView(block).setUint32(16, sampleRate);
	const files = [{ name: projectFile.name, mimeType: projectFile.type, buffer: Buffer.from(xml) },
		{ name: dataFile.name, mimeType: dataFile.type, buffer: Buffer.from(block) }];
	const recording = createWavFixture({ name: 'Independent.wav', duration: .1, frequency: 330, channelCount: 1 });
	const lane = editor.locator('.audio-editor-track-lane[data-track-lane]').first();
	const bounds = await lane.boundingBox(); expect(bounds).not.toBeNull();
	const transfer = await fileDataTransfer(page, [...files, recording]);
	const event = { dataTransfer: transfer, clientX: bounds.x + Math.min(220, bounds.width - 24), clientY: bounds.y + bounds.height / 2 };
	await lane.dispatchEvent('dragover', event); await lane.dispatchEvent('drop', event); await transfer.dispose();
	await expect(editor).not.toHaveAttribute('data-project-id', outgoingId); await waitForProjectActivation(editor);
	await expect(clipByName(editor, recording.name)).toBeVisible();
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(clipByName(editor, 'Outgoing.wav')).toHaveCount(0);
});
