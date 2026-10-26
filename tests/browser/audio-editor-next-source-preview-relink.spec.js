/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForEditor, openSourceMonitor, openExportDialog, chooseDropdown, closeDialog } from './audio-editor-test-helpers.js';
import { clearSourceProvenance, installLinkedAudioBridge } from './helpers/linked-audio-relink-fixture.js';

test('a paused neutral Source Monitor resumes the accepted replacement recording', async ({ page }) => {
	test.setTimeout(90_000);
	await installLinkedAudioBridge(page, {
		original: createWavFixture({ name: 'Original.wav', frequency: 330, duration: 2, channelCount: 1, channelAmplitudes: [.2] }),
		changed: createWavFixture({ name: 'Changed.wav', frequency: 660, duration: 2, channelCount: 1, channelAmplitudes: [.2] }),
	});
	await page.addInitScript(() => {
		const nativeConnect = AudioNode.prototype.connect;
		const observed = new Map();
		AudioNode.prototype.connect = function(...args) {
			if (args[0] !== this.context.destination || this.context instanceof OfflineAudioContext) return nativeConnect.apply(this, args);
			let analyser = observed.get(this.context);
			if (!analyser) {
				analyser = this.context.createAnalyser(); analyser.fftSize = 8192; analyser.smoothingTimeConstant = 0;
				observed.set(this.context, analyser); nativeConnect.call(analyser, this.context.destination);
			}
			nativeConnect.call(this, analyser); return args[0];
		};
		globalThis.__linkedSourceFrequency = () => {
			let peak = -Infinity, frequency = 0;
			for (const [context, analyser] of observed) {
				if (context.state === 'closed') continue;
				const values = new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(values);
				for (let index = 0; index < values.length; index++) if (values[index] > peak) {
					peak = values[index]; frequency = index * context.sampleRate / analyser.fftSize;
				}
			}
			return frequency;
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Link WAV', exact: true }).click();
	const card = editor.locator('[data-project-bin-item]').first(); await expect(card).toBeVisible();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await clearSourceProvenance(page, await editor.getAttribute('data-project-id'));
	await page.reload(); await waitForEditor(page);
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const source = await openSourceMonitor(page, editor, editor.locator('[data-clip-id]').first());
	try {
		await source.getByRole('button', { name: 'Loop selection', exact: true }).click();
		await source.getByRole('button', { name: 'Play', exact: true }).click();
		await expect.poll(async () => Math.abs(await page.evaluate(() => globalThis.__linkedSourceFrequency()) - 330)).toBeLessThan(10);
		await source.getByRole('button', { name: 'Pause', exact: true }).click();
		for (const [choice, frequency] of [['exact', 330], ['accepted', 660]]) {
			const reads = await page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.rangeRequests.length);
			await page.evaluate(next => { globalThis.__projectBinLinkedAudioFixture.next = next; }, choice);
			await card.getByRole('button', { name: /More file actions/u }).click();
			await page.getByRole('menuitem', { name: 'Relink', exact: true }).click();
			if (choice === 'accepted') {
				const changed = page.locator('[data-project-bin-relink-changed-dialog]'); await expect(changed).toBeVisible();
				await changed.getByRole('button', { name: 'Replace', exact: true }).click(); await expect(changed).toBeHidden();
			}
			await expect.poll(() => page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.rangeRequests.length)).toBeGreaterThan(reads);
			await expectExportedTone(page, editor, frequency);
			await source.getByRole('button', { name: 'Play', exact: true }).click();
			await expect.poll(async () => Math.abs(await page.evaluate(() => globalThis.__linkedSourceFrequency()) - frequency)).toBeLessThan(10);
			await expect(source.getByRole('button', { name: 'Loop selection', exact: true })).toHaveAttribute('aria-pressed', 'true');
			await source.getByRole('button', { name: 'Pause', exact: true }).click();
		}
	} finally { await source.getByRole('button', { name: 'Stop', exact: true }).click(); }
});

async function expectExportedTone(page, editor, frequency) {
	const count = await page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.exports.length);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.exports.length)).toBe(count + 1);
	await closeDialog(dialog);
	const actual = await page.evaluate(async () => {
		const bytes = globalThis.__projectBinLinkedAudioFixture.exports.at(-1);
		const context = new AudioContext();
		try {
			const audio = await context.decodeAudioData(bytes.buffer.slice(0));
			const pcm = audio.getChannelData(0), start = Math.floor(pcm.length / 4), end = Math.floor(pcm.length * 3 / 4);
			let crossings = 0;
			for (let frame = start + 1; frame < end; frame++) if (pcm[frame - 1] < 0 && pcm[frame] >= 0) crossings++;
			return crossings * audio.sampleRate / (end - start);
		} finally { await context.close(); }
	});
	expect(Math.abs(actual - frequency)).toBeLessThan(8);
}
