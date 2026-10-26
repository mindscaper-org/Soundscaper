/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { writeDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const looped of [true, false]) test(`DAWproject File Open delivers ${looped ? 'only the authored first loop pass' : 'ordinary unlooped content'}`, async ({ page }) => {
	test.setTimeout(60_000);
	const samples = Float32Array.from({ length: 192_000 }, (_, frame) => frame < 48_000 ? .25 : -.5);
	const audio = new Blob([encodeWav([samples], { sampleRate: 48_000, float: true })]);
	const archive = await writeDawprojectArchive({ metadataXml: '<MetaData><Title>Loop boundary</Title></MetaData>',
		projectXml: `<Project version="1.0"><Transport><Tempo unit="bpm" value="120"/></Transport><Structure><Track id="voice" name="Voice" contentType="audio"><Channel role="regular"/></Track></Structure>
		<Arrangement><Lanes timeUnit="seconds"><Lanes track="voice"><Clips><Clip time="0" duration="2" ${looped ? 'loopStart="0" loopEnd="1"' : ''} contentTimeUnit="seconds" name="Take">
		<Audio channels="1" sampleRate="48000" duration="4"><File path="audio/voice.wav"/></Audio></Clip></Clips></Lanes></Lanes></Arrangement></Project>`,
		files: [{ path: 'audio/voice.wav', blob: audio }] });
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Loop boundary.dawproject', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor.locator('[data-status]')).toContainText('DAWproject imported.', { timeout: 30_000 });
	await waitForProjectActivation(editor); await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseFileAction(page, editor, 'Delivery Report');
	const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
	if (looped) await expect(report).toContainText('only the first pass up to the authored loop end is retained');
	else await expect(report).not.toContainText('Clip looping is not imported');
	await page.keyboard.press('Escape'); await expect(report).toBeHidden();
	const delivered = await exportSamples(page, editor);
	if (looped) expect(delivered[delivered.length - 2400]).toBeGreaterThan(.17);
	expect(delivered).toHaveLength(looped ? 48_000 : 96_000);
	expect(delivered[24_000]).toBeGreaterThan(.17);
	if (!looped) expect(delivered[72_000]).toBeLessThan(-.34);
});
