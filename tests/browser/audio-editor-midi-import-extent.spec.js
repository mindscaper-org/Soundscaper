/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { strFromU8, unzipSync } from 'fflate';

for (const [duration, rest] of [[0.5, '8170'], [3, '9450']]) test(`File Import preserves the MIDI file's ${duration}-second ending`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	// 480 PPQ, 120 BPM: key release at tick240, then the declared remaining rest.
	const body = Buffer.from(`00ff510307a12000903c648170803c00${rest}ff2f00`, 'hex');
	const length = Buffer.alloc(4); length.writeUInt32BE(body.length);
	await importFiles(editor, [{ name: 'One phrase.mid', mimeType: 'audio/midi',
		buffer: Buffer.concat([Buffer.from('4d546864000000060000000101e04d54726b', 'hex'), length, body]) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const download = await downloading;
	const project = JSON.parse(strFromU8(unzipSync(await downloadBytes(download))['project.json']));
	await download.delete();
	expect(project.clips[0].durationFrames).toBe(Math.round(duration * project.sampleRate));
	expect(project.sources.find(source => source.id === project.clips[0].sourceId).frameCount).toBe(project.clips[0].durationFrames);
});
