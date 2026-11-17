/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, clipByName, closeClipProperties, closeDialog, importFiles, openClipProperties, showClipTimingFields } from './audio-editor-test-helpers.js';
import { setClipTimeFrames } from './audio-editor-clip-timing-test-helpers.js';

test('Project Bin Play retains a moved clip Auto Duck detector', async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__binDetectorAudible = 0;
		const connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (destination, ...ports) {
			const result = Reflect.apply(connect, this, [destination, ...ports]);
			if (destination !== this.context.destination || !(this.context instanceof AudioContext)) return result;
			const analyser = this.context.createAnalyser(); analyser.fftSize = 2048;
			Reflect.apply(connect, this, [analyser]);
			const values = new Float32Array(analyser.fftSize);
			const timer = setInterval(() => {
				if (this.context.state === 'closed') { clearInterval(timer); return; }
				analyser.getFloatTimeDomainData(values);
				if (values.some(sample => Math.abs(sample) > .001)) globalThis.__binDetectorAudible++;
			}, 20);
			return result;
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, ['music', 'guide'].map((name, index) => createWavFixture({ name: `${name}.wav`, frequency: index ? 1000 : 330, duration: 4, channelCount: 1 })));
	const clip = clipByName(editor, 'music.wav');
	const properties = await openClipProperties(page, editor, clip);
	await showClipTimingFields(properties);
	await setClipTimeFrames(properties, 'startFrame', 48000);
	await properties.getByText('Effects', { exact: true }).click();
	await addRackEffect(page, properties, 'track', 'Auto Duck');
	await closeDialog(page.getByRole('dialog', { name: 'Auto Duck', exact: true }));
	await closeClipProperties(properties);
	await clip.locator('.clip-header').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	const card = editor.getByRole('listitem', { name: 'Project bin: music', exact: true });
	await card.getByRole('button', { name: 'Play: music', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__binDetectorAudible)).toBeGreaterThan(0);
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await expect(card.getByRole('button', { name: 'Pause: music', exact: true })).toBeVisible();
	await card.getByRole('button', { name: 'Pause: music', exact: true }).click();
	await expect(card.getByRole('button', { name: 'Play: music', exact: true })).toBeVisible();
	await card.getByRole('button', { name: 'Play: music', exact: true }).click();
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await expect(card.getByRole('button', { name: 'Pause: music', exact: true })).toBeVisible();
});
