/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone } from './helpers/complex-editing-workflows.js';

test.use({ browserCoverage: false });
test('a Project Bin audition cannot start new audible playback during recording', async ({ page, browserName }) => {
	if (browserName === 'firefox') {
		await page.setContent('<button>Check native audio output</button>');
		await page.evaluate(bytes => {
			globalThis.binNativeOutput = new Promise((resolve, reject) => {
				document.querySelector('button').onclick = () => {
					const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }));
					const audio = new Audio(url);
					const finish = value => { resolve(value); audio.pause(); audio.removeAttribute('src'); URL.revokeObjectURL(url); };
					audio.addEventListener('error', () => finish(audio.error?.message ?? 'Unknown native media error'), { once: true });
					audio.addEventListener('timeupdate', () => { if (audio.currentTime > .05) finish(null); });
					void audio.play().catch(reject);
				};
			});
		}, [...createWavFixture({ name: 'Native output.wav', frequency: 440, duration: 1, channelCount: 1 }).buffer]);
		await page.getByRole('button', { name: 'Check native audio output', exact: true }).click();
		const nativeError = await page.evaluate(() => globalThis.binNativeOutput);
		test.skip(nativeError?.includes('OnMediaSinkAudioError'), 'The native Firefox output backend also refuses an independent PCM WAV.');
		expect(nativeError).toBeNull();
	}
	await installOscillatorMicrophone(page);
	await page.addInitScript(() => {
		const connect = AudioNode.prototype.connect;
		globalThis.binOutputPeak = 0;
		AudioNode.prototype.connect = function (destination, ...ports) {
			const result = Reflect.apply(connect, this, [destination, ...ports]);
			if (destination !== this.context.destination || !(this.context instanceof AudioContext)) return result;
			const analyser = this.context.createAnalyser();
			Reflect.apply(connect, this, [analyser]);
			const pcm = new Float32Array(analyser.fftSize);
			const timer = setInterval(() => {
				if (this.context.state === 'closed') { clearInterval(timer); return; }
				if (!globalThis.observeBinAudition) return;
				analyser.getFloatTimeDomainData(pcm);
				for (const sample of pcm) globalThis.binOutputPeak = Math.max(globalThis.binOutputPeak, Math.abs(sample));
			}, 20);
			return result;
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	const file = createWavFixture({ name: 'Audition.wav', duration: 6, frequency: 440, channelCount: 1 });
	await importFiles(editor, [file, createWavFixture({ name: 'Silent backing.wav', duration: 20, channelCount: 1 })]);
	await clipByName(editor, file.name).locator('.clip-header').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	const card = editor.getByRole('listitem', { name: 'Project bin: Audition', exact: true });
	const play = card.getByRole('button', { name: 'Play: Audition', exact: true });
	await expect(play).toBeEnabled();
	await page.evaluate(() => { globalThis.observeBinAudition = true; });
	await play.click();
	await expect.poll(() => page.evaluate(() => globalThis.binOutputPeak)).toBeGreaterThan(.01);
	await card.getByRole('button', { name: 'Pause: Audition', exact: true }).click();
	await expect(play).toBeVisible();
	await page.evaluate(() => { globalThis.binOutputPeak = 0; globalThis.observeBinAudition = false; });
	const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
	await record.click();
	try {
		await expect(record).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
		await page.evaluate(() => { globalThis.observeBinAudition = true; });
		const bounds = await play.boundingBox(); expect(bounds).not.toBeNull();
		await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
		if (await card.getByRole('button', { name: 'Pause: Audition', exact: true }).count()) {
			await expect.poll(() => page.evaluate(() => globalThis.binOutputPeak)).toBeGreaterThan(.01);
		}
		await expect(card.getByRole('button', { name: 'Pause: Audition', exact: true })).toHaveCount(0);
		expect(await page.evaluate(() => globalThis.binOutputPeak)).toBe(0);
		await expect(record).toHaveAttribute('aria-pressed', 'true');
	} finally { await editor.locator('[data-transport="stop"] button').first().click(); }
	await expect(play).toBeEnabled();
	await page.evaluate(() => { globalThis.observeBinAudition = true; });
	await play.click();
	await expect(card.getByRole('button', { name: 'Pause: Audition', exact: true })).toBeVisible();
	await expect.poll(() => page.evaluate(() => globalThis.binOutputPeak)).toBeGreaterThan(.01);
	await editor.locator('[data-transport="stop"] button').first().click();
});
