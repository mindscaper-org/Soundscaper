/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { writeDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { encodeWav } from '../../src/common/editor/wav.js';

test('File Open DAWproject renders a beat-linear fader correctly across a tempo change', async ({ page }) => {
	const archive = await writeDawprojectArchive({ metadataXml: '<MetaData/>',
		files: [{ path: 'take.wav', blob: new Blob([encodeWav([new Float32Array(96_000).fill(0.25)], { sampleRate: 48_000, float: true })]) }],
		projectXml: `<Project version="1.0"><Transport><Tempo unit="bpm" value="60" id="tempo"/></Transport>
		<Structure><Track id="track" contentType="audio"><Channel role="regular"><Volume id="volume" unit="linear" value="1"/></Channel></Track></Structure>
		<Arrangement><Lanes timeUnit="beats"><Lanes track="track"><Clips><Clip time="0" duration="2" contentTimeUnit="seconds">
		<Audio timeUnit="seconds"><File path="take.wav"/></Audio></Clip></Clips>
		<Points unit="linear"><Target parameter="volume"/><RealPoint time="0" value="0.2" interpolation="linear"/>
		<RealPoint time="2" value="1"/></Points></Lanes></Lanes>
		<TempoAutomation timeUnit="beats"><Target parameter="tempo"/><RealPoint time="0" value="60" interpolation="hold"/>
		<RealPoint time="1" value="120" interpolation="hold"/></TempoAutomation></Arrangement></Project>`,
	});
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Musical ramp.dawproject', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor.locator('[data-status]')).toHaveText('DAWproject imported.');
	const samples = await exportSamples(page, editor);
	expect(samples).toHaveLength(72_000);
	expect(samples[48_000] / samples[0]).toBeCloseTo(3, 2);
});
