/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFileSync } from 'node:fs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, fileDataTransfer, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { readAdlPackage } from '../../src/common/editor/aes31-package.ts';

for (const [product, path] of [['Soundscaper', '/embed/en/'], ['Framescaper', '/framescaper/embed/en/']]) {
	test(`${product}: import ADL with companion media, export AES31, then Open and drop the package`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, path, { defaultWorkspace: true });
		const adl = readFileSync(new URL('../fixtures/aes31/voice.adl', import.meta.url));
		const audio = encodeWav([new Float32Array(96_000).fill(.125), new Float32Array(96_000).fill(.5)], { sampleRate: 48_000, float: true });
		await importFiles(editor, [{ name: 'Voice.ADL', mimeType: 'text/plain', buffer: adl },
			{ name: 'voice.wav', mimeType: 'audio/wav', buffer: Buffer.from(audio) }]);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await waitForProjectActivation(editor);
		await expect(editor.getByRole('group', { name: /^Phrase clip,/u })).toHaveCount(1);
		const exporting = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export AES31 ADL']);
		const download = await exporting;
		expect(download.suggestedFilename()).toBe('Dialogue-atmosphere.adl.zip');
		const bytes = await downloadBytes(download);
		const document = await readAdlPackage(new Blob([new Uint8Array(bytes)]));
		expect(document.media[0].blob.size).toBeGreaterThan(96_000 * 3);
		expect(document.tracks[0].clips[0].sourceStart.num / document.tracks[0].clips[0].sourceStart.den).toBe(17 / 48_000);
		const fixture = { name: 'Restored.adl.zip', mimeType: 'application/zip', buffer: Buffer.from(bytes) };
		let previous = await editor.getAttribute('data-project-id');
		const choosing = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await choosing).setFiles(fixture);
		await expect(editor).not.toHaveAttribute('data-project-id', previous);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await waitForProjectActivation(editor);
		previous = await editor.getAttribute('data-project-id');
		const transfer = await fileDataTransfer(page, [fixture]);
		const timeline = editor.getByRole('region', { name: 'Timeline', exact: true }).getByRole('region', { name: 'Timeline', exact: true });
		await timeline.dispatchEvent('dragover', { dataTransfer: transfer });
		await timeline.dispatchEvent('drop', { dataTransfer: transfer });
		await transfer.dispose();
		await expect(editor).not.toHaveAttribute('data-project-id', previous);
		await expect(editor.getByRole('group', { name: /^Phrase clip,/u })).toHaveCount(1);
		await download.delete();
	});
}
