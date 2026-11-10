/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

const text = 'AutoDuck:DuckAmountDb="-12" InnerFadeDownLen="0" InnerFadeUpLen="0" OuterFadeDownLen="0.01" OuterFadeUpLen="0.01" ThresholdDb="-30" MaximumPause="0.1"\n';
for (const precedingSilent of [false, true]) test(`native AutoDuck follows control below selected music; preceding silent=${precedingSilent}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await chooseCommandAction(page, editor, 'Tracks', 'Remove tracks');
	const media = [
	 ...(precedingSilent ? [createWavFixture({name:'Silent.wav', frequency:220, duration:1, channelCount:1, channelAmplitudes:[0]})] : []),
	 createWavFixture({name:'Music.wav', frequency:440, duration:1, channelCount:1, channelAmplitudes:[.2]}),
	 createWavFixture({name:'Voice.wav', frequency:880, duration:1, channelCount:1, channelAmplitudes:[.5]}),
	];
	await importFiles(editor, media); await expect(editor).toHaveAttribute('data-clip-count', String(media.length));
	await clipByName(editor, 'Music.wav').locator('.clip-header').click();
	await chooseNestedCommandAction(page,editor,'Select',['Region','Track start to end']);
	await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'No tracks']);
	// Scope the retained range to Music with the normal track-header toggle.
	await clipByName(editor, 'Music.wav').locator('xpath=ancestor::div[@data-track-row][1]')
		.locator('.track-control-panel__track-name-text').click({ modifiers: ['ControlOrMeta'] });
	await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(1);
	const before = await exportSamples(page, editor);
	await chooseCommandAction(page,editor,'Tools','Macros palette');
	const manager = page.getByRole('dialog',{name:'Macros palette',exact:true});
	const choosing = page.waitForEvent('filechooser'); await manager.getByRole('button',{name:'Import macro',exact:true}).click();
	await (await choosing).setFiles({name:'Native duck.txt',mimeType:'text/plain',buffer:Buffer.from(text)});
	await manager.getByRole('button',{name:'Run macro',exact:true}).click(); await expect(manager).toContainText('Macro applied.');
	await manager.getByRole('button',{name:'Close',exact:true}).click();
	const after = await exportSamples(page,editor);
	const coefficient = values => {let sum=0;for(let frame=14400;frame<33600;frame++)sum+=values[frame]*Math.sin(2*Math.PI*440*frame/48000);return sum;};
	const ratio=coefficient(after)/coefficient(before); console.log('AutoDuck selected Music native expected belowVoice',JSON.stringify({precedingSilent,ratio}));
	expect(ratio).toBeCloseTo(10**(-12/20),2);
});
