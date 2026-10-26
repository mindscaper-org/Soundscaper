/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { strFromU8, unzipSync } from 'fflate';
import { bootEditor, chooseFileAction, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { writeDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { parseScapeProjectDocument } from '../../src/common/editor/scape-project-document.ts';
import { encodeWav } from '../../src/common/editor/wav.js';

for (const channels of [1, 2]) test(`DAWproject import reports ${channels === 1 ? 'changed mono' : 'unchanged stereo'} mixer-channel width`, async ({ page }) => {
	test.setTimeout(60_000);
	const archive = await writeDawprojectArchive({ metadataXml: '<MetaData><Title>Track widths</Title></MetaData>',
		projectXml: `<Project version="1.0"><Application name="Track widths" version="1"/><Structure><Track id="voice" name="Voice" contentType="audio"><Channel role="regular" audioChannels="${channels}"/></Track></Structure><Arrangement><Lanes timeUnit="seconds"><Lanes track="voice"><Clips><Clip time="0" duration=".1"><Audio channels="2" sampleRate="48000" duration=".1" timeUnit="seconds"><File path="audio/voice.wav"/></Audio></Clip></Clips></Lanes></Lanes></Arrangement></Project>`,
		files: [{ path: 'audio/voice.wav', blob: new Blob([encodeWav([new Float32Array(4800).fill(.25), new Float32Array(4800).fill(-.125)], { sampleRate: 48_000, float: true })]) }] });
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Track widths.dawproject', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor.locator('[data-status]')).toHaveText('DAWproject imported.', { timeout: 30_000 });
	await waitForProjectActivation(editor); await expect(editor).toHaveAttribute('data-clip-count', '1');
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const download = await saving; let bytes;
	try { bytes = await downloadBytes(download); } finally { await download.delete(); }
	const saved = parseScapeProjectDocument(strFromU8(unzipSync(bytes)['project.json']), { currentProjectSchemaFamily: 'soundscaper' });
	expect(saved.sources[0].channelCount).toBe(2); expect(saved.sources[0].frameCount).toBe(4800);
	await chooseFileAction(page, editor, 'Delivery Report');
	const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
	if (channels === 1) await expect(report).toContainText('The authored mixer-channel width is not preserved.');
	else await expect(report).not.toContainText('The authored mixer-channel width is not preserved.');
});
