/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, clipByName, chooseCommandAction, chooseDropdown, disableNativeSavePicker, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';
import { readWavePcm } from '../helpers/read-wave-pcm.ts';
import { localeCopy } from './helpers/locale-copy.js';

for (const wrap of [false, true]) test(`${wrap ? 'loop wrap' : 'ordinary interval'} spectral snap uses only the selected audible content`, async ({ page }) => {
	await page.setViewportSize({ width: 1920, height: 1000 });
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const file = createWavFixture({ name: 'selection-peaks.wav', frequency: 800, duration: 4, sampleRate: 8192, channelCount: 1, channelAmplitudes: [.4] });
	for (let frame = 8192; frame < 8192 * 3; frame += 1) file.buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 512 * frame / 8192) * .4 * 32767), 44 + frame * 2);
	await importFiles(editor, [file]);
	const clip = clipByName(editor, file.name);
	await clip.locator('.clip-header').click();
	const loop = clip.getByRole('slider', { name: 'Looped clip length', exact: true });
	await loop.press('ArrowRight'); await expect(loop).toHaveAttribute('aria-valuenow', '8');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Track display$/u }).click();
	const settings = preferences.locator('[data-spectrogram-settings]');
	await settings.getByLabel('Scale', { exact: true }).selectOption('linear');
	await settings.getByLabel('Minimum frequency (Hz)', { exact: true }).fill('0');
	await settings.getByLabel('Maximum frequency (Hz)', { exact: true }).fill('2000');
	await settings.getByLabel('Window size', { exact: true }).selectOption('2048');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const track = clip.locator('xpath=ancestor::div[@data-track-row]');
	await track.getByRole('button', { name: 'Track menu', exact: true }).click();
	const display = page.locator('.audio-editor-track-menu').getByRole('menuitem', { name: /^Track visualization(?:\s|$)/u });
	await display.focus(); await display.press('ArrowRight');
	await display.getByRole('menu').getByRole('menuitem', { name: 'Spectrogram', exact: true }).click();
	await expect(clip.locator('canvas.clip-body__waveform')).toHaveAttribute('data-spectrogram-renderer', 'pffft-wasm', { timeout: 20000 });
	const ruler = await editor.locator('[data-ruler-interaction]').boundingBox(); expect(ruler).not.toBeNull();
	const pixelsPerSecond = (await clip.boundingBox()).width / 8;
	const start = wrap ? 3.6 : .4, end = wrap ? 4.4 : .8;
	await page.mouse.move(ruler.x + start * pixelsPerSecond, ruler.y + ruler.height * .8);
	await page.mouse.down(); await page.mouse.move(ruler.x + end * pixelsPerSecond, ruler.y + ruler.height * .8, { steps: 6 }); await page.mouse.up();
	const output = await openExportDialog(page, editor);
	await chooseDropdown(page, output.getByRole('group', { name: localeCopy('en').exportMode, exact: true }), 'Current selection');
	await output.getByRole('button', { name: 'Export', exact: true }).click();
	const link = output.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 20000 });
	const wav = readWavePcm(await readDownloadBytes(page, link));
	await output.getByRole('button', { name: 'Close', exact: true }).click();
	const samples = wav.channels[0];
	const selected800 = amplitude(samples, wav.sampleRate, 800), selected512 = amplitude(samples, wav.sampleRate, 512);
	expect(selected800).toBeGreaterThan(.1); expect(selected512).toBeLessThan(.005);
	await editor.getByRole('button', { name: 'Spectrogram options', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Select spectral frequency range', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Spectral selection', exact: true });
	await dialog.getByRole('textbox', { name: /^Minimum frequency \(Hz\)/u }).fill('100');
	await dialog.getByRole('textbox', { name: /^Maximum frequency \(Hz\)/u }).fill('300');
	await dialog.getByRole('button', { name: 'Select range', exact: true }).click();
	const center = track.getByRole('slider', { name: 'Spectral selection center-frequency handle', exact: true });
	const box = await center.boundingBox(), lane = await track.locator('[data-track-lane]').boundingBox(); expect(box).not.toBeNull(); expect(lane).not.toBeNull();
	const bodyTop = Number(await track.locator('[data-track-lane]').getAttribute('data-channel-body-top'));
	const low = Number(await track.locator('[data-track-ruler]').getAttribute('data-ruler-frequency-minimum'));
	const high = Number(await track.locator('[data-track-ruler]').getAttribute('data-ruler-frequency-maximum'));
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2, lane.y + bodyTop + (lane.height - bodyTop) * (1 - (550 - low) / (high - low)), { steps: 4 }); await page.mouse.up();
	await expect.poll(async () => Number(await center.getAttribute('aria-valuenow'))).toBeCloseTo(800, 0);
});
function amplitude(samples, rate, frequency) {
	let sine = 0, cosine = 0;
	for (const [frame, value] of samples.entries()) { const phase = 2 * Math.PI * frequency * frame / rate; sine += value * Math.sin(phase); cosine += value * Math.cos(phase); }
	return 2 * Math.hypot(sine, cosine) / samples.length;
}
