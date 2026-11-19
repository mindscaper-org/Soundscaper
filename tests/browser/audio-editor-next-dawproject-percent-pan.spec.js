/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, disableNativeSavePicker, openExportDialog, readDownloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { writeDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../../src/common/editor/wav.js';

test('centered DAWproject percent and normalized pan stay centered in native stereo delivery', async ({ page }) => {
	const caseTimeout = test.info().timeout;
	test.setTimeout(caseTimeout * 2);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	for (const [unit, value] of [['percent', 50], ['normalized', .5]]) await test.step(`${unit} pan`, async () => {
		const archive = await writeDawprojectArchive({ metadataXml: '<MetaData/>', files: [{ path: 'take.wav',
			blob: new Blob([Uint8Array.from(encodeWav([new Float32Array(12_000).fill(.2)], { sampleRate: 48_000, float: true }))]),
		}], projectXml: `<Project version="1.0"><Structure><Track id="track" name="Recording" contentType="audio">
			<Channel role="regular" audioChannels="1"><Pan unit="${unit}" value="${value}"/></Channel></Track></Structure>
			<Arrangement><Lanes timeUnit="seconds"><Lanes track="track"><Clips><Clip time="0" duration=".25">
			<Audio timeUnit="seconds"><File path="take.wav"/></Audio></Clip></Clips></Lanes></Lanes></Arrangement></Project>`,
		});
		const previousId = await editor.getAttribute('data-project-id');
		const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
		await (await choosing).setFiles({ name: 'Centered pan.dawproject', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
		await expect(editor.locator('[data-status]')).toHaveText('DAWproject imported.');
		await expect(editor).not.toHaveAttribute('data-project-id', previousId);
		await waitForProjectActivation(editor);
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
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(dialog).toBeHidden();
	}, { timeout: caseTimeout });
});
