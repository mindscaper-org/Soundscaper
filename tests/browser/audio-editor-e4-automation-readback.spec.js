/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { installNativeOutputPeer } from './helpers/native-output-peer.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';


for (const native of [false, true]) for (const cancel of [false, true]) {
	test(`cancelled Touch retains the future gain step, native=${native}, cancel=${cancel}`, async ({ page, browserName }) => {
		test.skip(native && browserName !== 'chromium', 'Native audio hosts run in the maintained Electron renderer (Chromium).');
		const { project, blob } = await archive(`${native}-${cancel}`), errors = collectClientErrors(page);
		if (native) await installNativeOutputPeer(page);
		const editor = await bootEditor(page, '/embed/en/');
		await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Cancel.sscape', mimeType: 'application/zip',
			buffer: Buffer.from(await blob.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
		const opened = await persistedProject(page, project.id);
		if (native) await chooseNativeOutput(page, editor);
		else await chooseCommandAction(page, editor, 'Analyze', 'Analysis');
		const row = editor.locator('[data-track-row][data-track-id="voice"]');
		await chooseTrackMenuAction(page, editor, row, 'Add automation');
		await row.getByRole('combobox', { name: 'Automation mode' }).selectOption('touch');
		const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
		const reading = async () => native ? page.evaluate(() => window.__nativeOutput.mean)
			: Number.parseFloat(await editor.locator('[data-live-analysis-value="peak"]').textContent());
		const error = async gain => {
			const amplitude = .25 * Math.SQRT1_2 * gain;
			return Math.abs(await reading() - (native ? amplitude : 20 * Math.log10(amplitude)));
		};
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect.poll(() => error(.2)).toBeLessThan(native ? .00005 : .06);
		await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(24_000);
		if (cancel) {
			await row.getByRole('slider', { name: 'Volume', exact: true }).focus();
			await page.keyboard.down('ArrowLeft'); await page.keyboard.press('Escape'); await page.keyboard.up('ArrowLeft');
		}
		await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(240_000);
		const stored = await persistedProject(page, project.id);
		expect(stored.automationLanes).toEqual(opened.automationLanes);
		expect(stored.revision).toBe(opened.revision);
		expect(errors).toEqual([]);
		if (native) expect(await page.evaluate(() => window.__nativeOutput.loss)).toEqual([]);
		await expect.poll(() => error(.8)).toBeLessThan(native ? .00005 : .06);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	});
}

async function chooseNativeOutput(page, editor) {
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Audio settings$/u }).click();
	await preferences.getByRole('combobox', { name: 'Host', exact: true }).selectOption('alsa');
	await expect(preferences.getByRole('combobox', { name: 'Speakers', exact: true })).toContainText('Chosen native speakers');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
}

async function archive(cancel){
 const source=createAudioSource({id:'source',sampleRate:48000,frameCount:576000,channelCount:1});
 const project=createSoundscaperProject({id:`cancel-readback-${cancel}`,sources:[source],
 clips:[createAudioClip({id:'clip',sourceId:source.id,sourceDurationFrames:source.frameCount,durationFrames:source.frameCount})],
 tracks:[createAudioTrack({id:'voice',clipIds:['clip']})],automationLanes:[{id:'gain',address:{kind:'strip',strip:{kind:'track',id:'voice'},parameterId:'gain'},timebase:'absolute-samples',
 points:[{id:'a',position:0,value:.2},{id:'b',position:192000,value:.8},{id:'c',position:576000,value:.8}],segments:[{kind:'hold'},{kind:'hold'}]}]});
 const store=createProjectStore({indexedDB:null,preferOpfs:false,databaseName:crypto.randomUUID()});
 try{const writer=await store.beginSourceWrite(source.storageKey,source);for(let frame=0;frame<source.frameCount;frame+=source.chunkFrames)await writer.write([new Float32Array(Math.min(source.chunkFrames,source.frameCount-frame)).fill(.25)]);await writer.commit();const{blob}=await exportScapeProject(project,store);return{project,blob};}finally{await store.close();}
}
