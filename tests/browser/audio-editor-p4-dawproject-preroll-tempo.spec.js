/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { writeDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../../src/common/editor/wav.js';

for (const at of [-4, 0, null]) test(`File Open preserves a held tempo point at ${String(at)} before WAV delivery`, async ({ page }) => {
	test.setTimeout(60_000);
	const xml = `<Project version="1.0"><Application name="Preroll tempo" version="1"/><Transport><Tempo unit="bpm" value="120" id="tempo"/></Transport>
	<Structure><Track id="voice" name="Voice" contentType="audio"><Channel role="regular" audioChannels="2"/></Track></Structure>
	<Arrangement><Lanes timeUnit="beats"><Lanes track="voice"><Clips><Clip time="2" duration="2" contentTimeUnit="seconds">
	<Audio channels="2" sampleRate="48000" duration="2"><File path="voice.wav"/></Audio></Clip></Clips></Lanes></Lanes>
	${at === null ? '' : `<TempoAutomation unit="bpm"><Target parameter="tempo"/><RealPoint time="${at}" value="60" interpolation="hold"/></TempoAutomation>`}</Arrangement></Project>`;
	const pcm = new Float32Array(96_000).fill(.25);
	const archive = await writeDawprojectArchive({ projectXml: xml, metadataXml: '<MetaData/>', files: [{ path: 'voice.wav', blob: new Blob([encodeWav([pcm, pcm], { sampleRate: 48_000, float: true })]) }] });
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Preroll tempo.dawproject', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor.locator('[data-status]')).toHaveText('DAWproject imported.', { timeout: 30_000 }); await waitForProjectActivation(editor);
	const samples = await exportSamples(page, editor); const start = at === null ? 48_000 : 96_000;
	expect(samples).toHaveLength(start * 2); expect(Math.max(...samples.slice(0, start - 500).map(Math.abs))).toBeLessThan(.00001);
	expect(samples[start + 1000]).toBeCloseTo(.25, 5); expect(samples[start * 2 - 1000]).toBeCloseTo(.25, 5);
});
