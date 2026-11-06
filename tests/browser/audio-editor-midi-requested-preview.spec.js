/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

for (const waitForPublication of [true, false]) test(`a note preview uses the requested pitch after PCM publication (wait:${waitForPublication})`, async ({ page }) => {
	await page.addInitScript(() => { globalThis.__holdMidiWrite = false; globalThis.__midiWriteEntered = false; globalThis.__previewVoices = []; globalThis.__midiEditPublished = false; });
	await page.route(/\/midi-service-[^/]+\.js$/u, async route => {
		const response = await route.fetch(), body = await response.text();
		const factory = body.match(/([\w$]+)\s+as\s+createMidiService/u);
		expect(factory).not.toBeNull();
		const observed = body.replace(factory[0], 'observedMidiFactory as createMidiService') + `
const observedMidiFactory=(dependencies)=>{const service=${factory[1]}({...dependencies,store:{
	deleteSource:(...args)=>dependencies.store.deleteSource(...args),
	async beginSourceWrite(...args){const writer=await dependencies.store.beginSourceWrite(...args);return {
		write:async(...channels)=>{if(globalThis.__holdMidiWrite){globalThis.__holdMidiWrite=false;globalThis.__midiWriteEntered=true;await new Promise(resolve=>{globalThis.__releaseMidiWrite=resolve;});}return writer.write(...channels);},
		commit:(...args)=>writer.commit(...args),abort:(...args)=>writer.abort(...args)
	};}
}});return {...service,async updateNotes(...args){const result=await service.updateNotes(...args);globalThis.__midiEditPublished=true;return result;}};};`;
		await route.fulfill({ response, body: observed });
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'Preview.mid', mimeType: 'audio/midi', buffer: Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000903c648360803c0000ff2f00', 'hex') }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	const selected = panel.getByRole('combobox', { name: 'Selected note', exact: true });
	await selected.selectOption({ index: 1 });
	const pitch = panel.getByRole('spinbutton', { name: 'Pitch (MIDI number)', exact: true });
	await expect(pitch).toHaveValue('60');
	await page.evaluate(() => {
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			const buffer = this.buffer;
			if (buffer?.length === Math.round(this.context.sampleRate * .35)) {
				const pcm = buffer.getChannelData(0), crossings = [];
				let sum = 0, length = 0;
				for (let frame = Math.round(buffer.sampleRate * .05); frame < Math.round(buffer.sampleRate * .25); frame++) {
					if (pcm[frame - 1] < 0 && pcm[frame] >= 0) crossings.push(frame);
					sum += pcm[frame] * pcm[frame]; length++;
				}
				globalThis.__previewVoices.push({ frequency: (crossings.length - 1) * buffer.sampleRate / (crossings.at(-1) - crossings[0]),
					rms: Math.sqrt(sum / length), context: this.context.state });
			}
			return Reflect.apply(start, this, args);
		};
		globalThis.__holdMidiWrite = true; globalThis.__midiEditPublished = false;
	});
	try {
		await pitch.focus(); await pitch.press('ControlOrMeta+a'); await pitch.pressSequentially('67');
		if (waitForPublication) {
			await pitch.press('Tab');
			await expect.poll(() => page.evaluate(() => globalThis.__midiWriteEntered)).toBe(true);
			await page.evaluate(() => globalThis.__releaseMidiWrite());
			await expect.poll(() => page.evaluate(() => globalThis.__midiEditPublished)).toBe(true);
			await expect(selected.locator('option').nth(1)).toContainText('67');
		}
		await panel.getByRole('button', { name: 'Preview selected note', exact: true }).click();
		if (!waitForPublication) {
			await expect.poll(() => page.evaluate(() => globalThis.__midiWriteEntered)).toBe(true);
			await expect.poll(() => page.evaluate(() => globalThis.__previewVoices.length)).toBe(1);
			expect(await page.evaluate(() => globalThis.__midiEditPublished)).toBe(false);
			await page.evaluate(() => globalThis.__releaseMidiWrite());
			await expect.poll(() => page.evaluate(() => globalThis.__midiEditPublished)).toBe(true);
			await expect(selected.locator('option').nth(1)).toContainText('67');
		}
		await expect.poll(() => page.evaluate(() => globalThis.__previewVoices.length)).toBe(1);
		const voice = await page.evaluate(() => globalThis.__previewVoices[0]);
		expect(voice.context).toBe('running'); expect(voice.rms).toBeGreaterThan(.01);
		expect(voice.frequency).toBeCloseTo(440 * 2 ** ((67 - 69) / 12), 0);
	} finally { await page.evaluate(() => globalThis.__releaseMidiWrite?.()); }
});
