/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, disableNativeSavePicker, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';
import { writeDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../../src/common/editor/wav.js';

for (const [unit, value] of [['percent', 50], ['normalized', .5]]) {
	test(`centered DAWproject ${unit} pan stays centered in the delivered stereo file`, async ({ page }) => {
		const archive = await writeDawprojectArchive({ metadataXml: '<MetaData/>', files: [{ path: 'take.wav',
			blob: new Blob([Uint8Array.from(encodeWav([new Float32Array(12_000).fill(.2)], { sampleRate: 48_000, float: true }))]),
		}], projectXml: `<Project version="1.0"><Structure><Track id="track" name="Recording" contentType="audio">
			<Channel role="regular" audioChannels="1"><Pan unit="${unit}" value="${value}"/></Channel></Track></Structure>
			<Arrangement><Lanes timeUnit="seconds"><Lanes track="track"><Clips><Clip time="0" duration=".25">
			<Audio timeUnit="seconds"><File path="take.wav"/></Audio></Clip></Clips></Lanes></Lanes></Arrangement></Project>`,
		});
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
		await (await choosing).setFiles({ name: 'Centered pan.dawproject', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
		await expect(editor.locator('[data-status]')).toHaveText('DAWproject imported.');
		const dialog = await openExportDialog(page, editor);
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible();
		const bytes = await readDownloadBytes(page, link);
		const pcm = await page.evaluate(async bytes => {
			const context = new AudioContext({ sampleRate: 48_000 });
			try {
				const audio = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
				return Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index)[1000]);
			} finally { await context.close(); }
		}, Array.from(bytes));
		expect(pcm).toHaveLength(2);
		expect(pcm[0]).toBeGreaterThan(.01);
		expect(pcm[1] / pcm[0]).toBeCloseTo(1, 3);
	});
}
