/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { writeDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../../src/common/editor/wav.js';

for (const kind of ['track', 'clip', 'padded']) test(`P020 ancillary: DAWproject ${kind} display name preserves healthy audio`, async ({ page }) => {
	test.setTimeout(60_000);
	const track = kind === 'track' ? '   ' : ' Voice ', clip = kind === 'clip' ? '   ' : ' Take ';
	const xml = `<Project version="1.0"><Application name="Blank names" version="1"/><Structure><Track id="voice" name="${track}" contentType="audio"><Channel role="regular" audioChannels="2"/></Track></Structure><Arrangement><Lanes timeUnit="seconds"><Lanes track="voice"><Clips><Clip time="0" duration=".1" name="${clip}"><Audio channels="2" sampleRate="48000" duration=".1"><File path="voice.wav"/></Audio></Clip></Clips></Lanes></Lanes></Arrangement></Project>`;
	const pcm = new Float32Array(4800).fill(.25), archive = await writeDawprojectArchive({ projectXml: xml, metadataXml: '<MetaData/>', files: [{ path: 'voice.wav', blob: new Blob([encodeWav([pcm, pcm], { sampleRate: 48_000, float: true })]) }] });
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Blank names.dawproject', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor.locator('[data-status]')).toHaveText('DAWproject imported.', { timeout: 30_000 }); await waitForProjectActivation(editor);
	const samples = await exportSamples(page, editor); expect(samples).toHaveLength(4800); expect(samples[2000]).toBeCloseTo(.25, 5);
});
