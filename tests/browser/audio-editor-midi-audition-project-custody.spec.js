/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

for (const changeProject of [false, true]) test(`a staged piano audition respects project replacement=${changeProject}`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [{ name: 'voice.mid', mimeType: 'audio/midi', buffer: Buffer.from(
		'4d546864000000060000000101e04d54726b0000001400ff510307a12000903c648360803c0000ff2f00', 'hex') }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	await panel.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
	const before = await editor.getAttribute('data-project-id');
	await page.evaluate(() => {
		globalThis.__midiVoices = [];
		const resume = AudioContext.prototype.resume;
		let gated = false;
		AudioContext.prototype.resume = function (...args) {
			const resumed = Reflect.apply(resume, this, args);
			if (gated) return resumed;
			gated = true; globalThis.__midiContextEntered = true;
			return Promise.resolve(resumed).then(() => new Promise(resolve => { globalThis.__releaseMidiContext = resolve; }));
		};
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.buffer?.length === Math.round(this.context.sampleRate * .35)) {
				const analyser = this.context.createAnalyser(), silence = this.context.createGain();
				silence.gain.value = 0; this.connect(analyser); analyser.connect(silence); silence.connect(this.context.destination);
				const voice = { project: document.querySelector('[data-project-id]')?.getAttribute('data-project-id'), peak: 0 };
				globalThis.__midiVoices.push(voice);
				const samples = new Float32Array(analyser.fftSize);
				let reads = 0;
				const read = () => {
					analyser.getFloatTimeDomainData(samples);
					voice.peak = Math.max(voice.peak, ...samples.map(sample => Math.abs(sample)));
					if (++reads < 10 && voice.peak < .01) requestAnimationFrame(read);
					else { analyser.disconnect(); silence.disconnect(); }
				};
				requestAnimationFrame(read);
			}
			return Reflect.apply(start, this, args);
		};
	});
	await panel.getByRole('button', { name: 'Preview selected note', exact: true }).click();
	await expect.poll(() => page.evaluate(() => Boolean(globalThis.__midiContextEntered && globalThis.__releaseMidiContext))).toBe(true);
	expect(await page.evaluate(() => globalThis.__midiVoices)).toEqual([]);
	if (changeProject) {
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await expect(editor).not.toHaveAttribute('data-project-id', before);
	}
	await page.evaluate(async () => {
		globalThis.__releaseMidiContext();
		await new Promise(resolve => { requestAnimationFrame(() => { requestAnimationFrame(resolve); }); });
	});
	if (!changeProject) {
		await expect.poll(() => page.evaluate(() => globalThis.__midiVoices[0]?.peak ?? 0)).toBeGreaterThan(.01);
		expect(await page.evaluate(() => globalThis.__midiVoices[0].project)).toBe(before);
	} else {
		// A real source after the project changed is independently observed PCM, not a playing-state flag.
		if (await page.evaluate(() => globalThis.__midiVoices.length)) await expect.poll(() => page.evaluate(() => globalThis.__midiVoices[0]?.peak ?? 0)).toBeGreaterThan(.01);
		expect(await page.evaluate(() => globalThis.__midiVoices)).toEqual([]);
	}
});
