/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { writeDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { exportSamples } from './helpers/round2-audio-export.js';

test('File Open DAWproject delivers native 3000Hz and 48000Hz sources on their programme clocks', async ({ page }) => {
	test.setTimeout(120_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	for (const rate of [3000, 48000]) await test.step(`${rate}Hz source`, async () => {
		const wav = createWavFixture({ name: 'voice.wav', frequency: 500, duration: 1, sampleRate: rate, channelCount: 1 });
		const archive = await writeDawprojectArchive({ metadataXml: '<MetaData><Title>Source clock</Title></MetaData>',
			projectXml: `<Project version="1.0"><Transport><Tempo unit="bpm" value="120"/></Transport>
		<Structure><Track id="voice" name="Voice" contentType="audio"><Channel role="regular"/></Track></Structure>
		<Arrangement><Lanes timeUnit="seconds"><Lanes track="voice"><Clips><Clip time="0.5" duration="1" contentTimeUnit="seconds">
		<Audio channels="1" sampleRate="${rate}" duration="1"><File path="audio/voice.wav"/></Audio>
		</Clip></Clips></Lanes></Lanes></Arrangement></Project>`, files: [{ path: 'audio/voice.wav', blob: new Blob([wav.buffer]) }] });
		const previousId = await editor.getAttribute('data-project-id');
		const choosing = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await choosing).setFiles({ name: 'Source clock.dawproject', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
		await expect(editor.locator('[data-status]')).toContainText('DAWproject imported.', { timeout: 20_000 });
		await expect(editor).not.toHaveAttribute('data-project-id', previousId);
		await waitForProjectActivation(editor);
		await expect(editor.locator('[data-clip-id]')).toHaveCount(1);
		const samples = await exportSamples(page, editor);
		expect(samples).toHaveLength(72_000);
		expect(Math.max(...samples.slice(0, 23_000).map(Math.abs))).toBeLessThan(.00001);
		const inside = samples.slice(30_000, 66_000);
		let real = 0; let imaginary = 0;
		for (let frame = 0; frame < inside.length; frame += 1) {
			const angle = 2 * Math.PI * 500 * frame / 48_000;
			real += inside[frame] * Math.cos(angle); imaginary += inside[frame] * Math.sin(angle);
		}
		expect(2 * Math.hypot(real, imaginary) / inside.length).toBeGreaterThan(.2);
	}, { timeout: 60_000 });
});
