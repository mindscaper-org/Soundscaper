/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { writeDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../../src/common/editor/wav.js';

test('File Open DAWproject renders a linear decibel ramp at its authored midpoint', async ({ page }) => {
	const archive = await writeDawprojectArchive({ metadataXml: '<MetaData/>',
		files: [{ path: 'take.wav', blob: new Blob([encodeWav([new Float32Array(96_000).fill(0.25)], { sampleRate: 48_000, float: true })]) }],
		projectXml: `<Project version="1.0"><Structure><Track id="track" name="Recording" contentType="audio">
		<Channel role="regular"><Volume id="volume" unit="decibel" value="0"/></Channel></Track></Structure>
		<Arrangement><Lanes timeUnit="seconds"><Lanes track="track"><Clips><Clip time="0" duration="2">
		<Audio timeUnit="seconds"><File path="take.wav"/></Audio></Clip></Clips>
		<Points unit="decibel"><Target parameter="volume"/><RealPoint time="0" value="-20" interpolation="linear"/>
		<RealPoint time="2" value="0"/></Points></Lanes></Lanes></Arrangement></Project>`,
	});
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Decibel ramp.dawproject', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor.locator('[data-status]')).toHaveText('DAWproject imported.');
	const samples = await exportSamples(page, editor);
	expect(samples).toHaveLength(96_000);
	expect(samples[48_000] / samples[0]).toBeCloseTo(10 ** (10 / 20), 2);
});
