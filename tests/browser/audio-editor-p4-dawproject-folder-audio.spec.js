/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { writeDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';

for (const send of [false, true]) for (const ownAudio of [true, false]) test(`DAWproject ${ownAudio ? 'folder-owned' : 'child'} recording follows its authored submix automation${send ? ' and send' : ''}`, async ({ page }) => {
	test.setTimeout(90_000);
	const clip = '<Clips><Clip time="0" duration=".1" contentTimeUnit="seconds"><Audio channels="2" sampleRate="48000" duration=".1"><File path="audio/voice.wav"/></Audio></Clip></Clips>';
	const sends = send ? '<Sends><Send destination="wet" type="post"><Volume unit="linear" value=".5"/></Send></Sends>' : '';
	const xml = `<Project version="1.0"><Application name="Folder items" version="1"/><Structure>
	<Track id="folder" name="Dialogue" contentType="tracks audio"><Channel id="bus" role="submix" audioChannels="2" destination="master"><Volume id="fader" unit="linear" value=".5"/>${sends}</Channel>
	<Track id="child" name="Peer" contentType="audio"><Channel id="child-channel" role="regular" audioChannels="2" destination="bus"/></Track></Track>
	${send ? '<Track id="return" name="Wet" contentType="audio"><Channel id="wet" role="effect" audioChannels="2" destination="master"/></Track>' : ''}
	<Track id="master-track" name="Master" contentType="audio"><Channel id="master" role="master" audioChannels="2"/></Track>
	</Structure><Arrangement><Lanes timeUnit="seconds"><Lanes track="folder">${ownAudio ? clip : ''}<Points unit="linear"><Target parameter="fader"/><RealPoint time="0" value=".2" interpolation="hold"/></Points></Lanes>
	<Lanes track="child">${ownAudio ? '' : clip}</Lanes></Lanes></Arrangement></Project>`;
	const audio = new Blob([encodeWav([new Float32Array(4800).fill(.25), new Float32Array(4800).fill(-.125)], { sampleRate: 48_000, float: true })]);
	const archive = await writeDawprojectArchive({ projectXml: xml, metadataXml: '<MetaData/>', files: [{ path: 'audio/voice.wav', blob: audio }] });
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Folder audio.dawproject', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor.locator('[data-status]')).toContainText('DAWproject imported.', { timeout: 30_000 }); await waitForProjectActivation(editor);
	const samples = await exportSamples(page, editor); expect(samples).toHaveLength(4800);
	expect(samples[2000]).toBeCloseTo(send ? .075 : .05, 5);
});
