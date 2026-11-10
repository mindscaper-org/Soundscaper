/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../../src/common/editor/wav-import.js';
import {
	addRackEffect, bootEditor, chooseDropdown, closeDialog, closeEffectsPanel, collectClientErrors, commitInput,
	disableNativeSavePicker, importFiles, openEffectsForTrack, openExportDialog, readDownloadBytes, registerAudioEditorHooks, waitForEditor,
} from './audio-editor-test-helpers.js';

async function observeAutoTune(page) {
	await page.addInitScript(() => {
		const records = { created: 0, configured: 0, disposed: 0, analyser: null };
		globalThis.__autoTune = records;
		const NativeNode = globalThis.AudioWorkletNode;
		globalThis.AudioWorkletNode = new Proxy(NativeNode, {
			construct(Constructor, args) {
				const node = Reflect.construct(Constructor, args);
				if (args[1] === 'kw-auto-tune') {
					records.created++;
					const context = args[0], analyser = context.createAnalyser(), mute = context.createGain();
					analyser.fftSize = 8192;
					mute.gain.value = 0;
					node.connect(analyser).connect(mute).connect(context.destination);
					records.analyser = analyser;
					const post = node.port.postMessage.bind(node.port);
					node.port.postMessage = (...messages) => {
						if (messages[0]?.type === 'configure') records.configured++;
						if (messages[0]?.type === 'dispose') {
							records.disposed++;
							analyser.disconnect(); mute.disconnect();
						}
						return post(...messages);
					};
				}
				return node;
			},
		});
	});
}

async function outputPitch(page) {
	return page.evaluate(() => {
		const analyser = globalThis.__autoTune.analyser;
		if (!analyser) return 0;
		const pcm = new Float32Array(analyser.fftSize);
		analyser.getFloatTimeDomainData(pcm);
		const crossings = [];
		for (let frame = 1; frame < pcm.length; frame++) {
			if (pcm[frame - 1] <= 0 && pcm[frame] > 0) crossings.push(frame - 1 - pcm[frame - 1] / (pcm[frame] - pcm[frame - 1]));
		}
		return crossings.length < 20 ? 0 : (crossings.length - 1) * analyser.context.sampleRate / (crossings.at(-1) - crossings[0]);
	});
}

test.describe('Auto-Tune realtime rack', () => {
	registerAudioEditorHooks();

	test('offline WAV export retains corrected pitch and trims the rack delay', async ({ page }) => {
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		await importFiles(editor, [createWavFixture({ name: 'export-voice.wav', frequency: 450, duration: 1, sampleRate: 48000 })]);
		const panel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, panel, 'track', 'Auto-Tune');
		const settings = page.getByRole('dialog', { name: 'Auto-Tune', exact: true });
		await commitInput(settings.getByRole('spinbutton', { name: 'Retune speed', exact: true }), '0');
		await closeDialog(settings);
		await closeEffectsPanel(panel);
		const dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const download = dialog.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 20000 });
		const wav = new Blob([await readDownloadBytes(page, download)]);
		const metadata = await inspectWavBlobPcm(wav);
		expect(metadata.frameCount).toBe(48000);
		expect(metadata.sampleRate).toBe(48000);
		const samples = [];
		await streamWavBlobPcm(wav, { onChunk: channels => { samples.push(...channels[0]); } });
		const crossings = [];
		for (let frame = 12000; frame < 36000; frame++) {
			if (samples[frame - 1] <= 0 && samples[frame] > 0) crossings.push(frame - 1 - samples[frame - 1] / (samples[frame] - samples[frame - 1]));
		}
		expect(crossings.length).toBeGreaterThan(100);
		const pitch = (crossings.length - 1) * 48000 / (crossings.at(-1) - crossings[0]);
		expect(Math.abs(pitch - 440)).toBeLessThan(1);
		expect(errors).toEqual([]);
	});

	test('corrects live audio, changes controls without replacing the node, and restores the saved rack', async ({ page }) => {
		await observeAutoTune(page);
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		await importFiles(editor, [createWavFixture({ name: 'live-voice.wav', frequency: 450, duration: 25, sampleRate: 48000 })]);
		let panel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, panel, 'track', 'Auto-Tune');
		let dialog = page.getByRole('dialog', { name: 'Auto-Tune', exact: true });
		await commitInput(dialog.getByRole('spinbutton', { name: 'Retune speed', exact: true }), '0');
		await closeDialog(dialog);
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await expect.poll(async () => Math.abs(await outputPitch(page) - 440)).toBeLessThan(1);
		const created = await page.evaluate(() => globalThis.__autoTune.created);
		await panel.locator('[data-effect-rack]').getByRole('group', { name: 'Auto-Tune', exact: true })
			.getByRole('button', { name: 'Select effect', exact: true }).click();
		dialog = page.getByRole('dialog', { name: 'Auto-Tune', exact: true });
		await chooseDropdown(page, dialog.getByRole('group', { name: 'Key', exact: true }), 'A');
		await chooseDropdown(page, dialog.getByRole('group', { name: 'Scale', exact: true }), 'Natural minor');
		await commitInput(dialog.getByRole('spinbutton', { name: 'Correction amount', exact: true }), '50');
		await expect.poll(async () => Math.abs(await outputPitch(page) - Math.sqrt(450 * 440))).toBeLessThan(1);
		await commitInput(dialog.getByRole('spinbutton', { name: 'Mix', exact: true }), '0');
		await expect.poll(async () => Math.abs(await outputPitch(page) - 450)).toBeLessThan(1);
		expect(await page.evaluate(() => globalThis.__autoTune.created)).toBe(created);
		expect(await page.evaluate(() => globalThis.__autoTune.configured)).toBeGreaterThan(0);
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await closeDialog(dialog);
		await editor.locator('[data-transport="stop"] button').click();
		await expect.poll(() => page.evaluate(() => globalThis.__autoTune.disposed)).toBeGreaterThan(0);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10000 });
		await page.reload();
		editor = await waitForEditor(page);
		panel = await openEffectsForTrack(editor, 1);
		await panel.locator('[data-effect-rack]').getByRole('group', { name: 'Auto-Tune', exact: true })
			.getByRole('button', { name: 'Select effect', exact: true }).click();
		dialog = page.getByRole('dialog', { name: 'Auto-Tune', exact: true });
		await expect(dialog.getByRole('spinbutton', { name: 'Correction amount', exact: true })).toHaveValue('50');
		await expect(dialog.getByRole('spinbutton', { name: 'Mix', exact: true })).toHaveValue('0');
		await expect(dialog.getByRole('group', { name: 'Scale', exact: true }).getByRole('button')).toContainText('Natural minor');
		await closeDialog(dialog);
		expect(errors).toEqual([]);
	});
});
