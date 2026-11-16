/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, disableNativeSavePicker, openExportDialog, readDownloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';

// Node independently renders and reopens each profile. One native timeline keeps
// all unequal/equal envelopes and both pan directions without repeating startup.
test('legacy linked stereo profiles retain channel envelopes and pan through native WAV export and reload', async ({ page }) => {
	test.setTimeout(90_000);
	const profiles = [[.25, 0], [.25, .5], [.25, -.5], [1, 0]];
	const frames = 4800, bytes = new Uint8Array(24 + frames * 4), view = new DataView(bytes.buffer);
	for (const [index, value] of [0x2e736e64, 24, frames * 4, 6, 48_000, 1].entries()) view.setUint32(index * 4, value);
	for (let frame = 0; frame < frames; frame++) view.setFloat32(24 + frame * 4, .1);
	const tracks = profiles.map(([rightGain, pan], profile) => {
		const channel = (index, gain) => `<wavetrack name="Stereo ${profile}" channel="${index}" linked="${index === 0 ? 1 : 0}" rate="48000" gain="1" pan="${pan}"><waveclip name="Stereo ${profile}" offset="${profile / 10}">`
			+ `<sequence numsamples="${frames}"><waveblock start="0"><simpleblockfile filename="e000${index}.au" len="${frames}"/></waveblock></sequence>`
			+ `<envelope numpoints="2"><controlpoint t="0" val="${gain}"/><controlpoint t=".1" val="${gain}"/></envelope></waveclip></wavetrack>`;
		return channel(0, 1) + channel(1, rightGain);
	});
	const xml = `<project rate="48000">${tracks.join('')}</project>`;
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles([{ name: 'Stereo envelopes.aup', mimeType: 'text/xml', buffer: Buffer.from(xml) },
		{ name: 'e0000.au', mimeType: 'audio/basic', buffer: Buffer.from(bytes) }, { name: 'e0001.au', mimeType: 'audio/basic', buffer: Buffer.from(bytes) }]);
	await expect(editor.locator('[data-status]')).toContainText('Imported the legacy AUP tracks, clips, and labels.', { timeout: 30_000 });
	await waitForProjectActivation(editor); const projectId = await editor.getAttribute('data-project-id');
	await expect(editor).toHaveAttribute('data-clip-count', '7');
	const inspectExport = async () => {
		const dialog = await openExportDialog(page, editor); await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 20_000 });
		const data = await readDownloadBytes(page, link);
		const result = await page.evaluate(async bytes => {
			const context = new AudioContext({ sampleRate: 48_000 });
			try {
				const buffer = await context.decodeAudioData(new Uint8Array(bytes).buffer);
				return { frames: buffer.length, channels: buffer.numberOfChannels,
					profiles: Array.from({ length: 4 }, (_, profile) => [0, 1].map(channel => buffer.getChannelData(channel)[profile * 4800 + 1000])) };
			} finally { await context.close(); }
		}, Array.from(data));
		expect(result.frames).toBe(frames * profiles.length); expect(result.channels).toBe(2);
		for (const [profile, [rightGain, pan]] of profiles.entries()) {
			const left = pan > 0 ? .1 * Math.cos(pan * Math.PI / 2) : .1 + .1 * rightGain * Math.cos((pan + 1) * Math.PI / 2);
			const right = pan < 0 ? .1 * rightGain * Math.sin((pan + 1) * Math.PI / 2) : .1 * rightGain + .1 * Math.sin(pan * Math.PI / 2);
			expect(result.profiles[profile][0]).toBeCloseTo(left, 5);
			expect(result.profiles[profile][1]).toBeCloseTo(right, 5);
		}
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	};
	await inspectExport(); await page.reload(); await expect(editor).toHaveAttribute('data-project-id', projectId); await waitForProjectActivation(editor); await inspectExport();
});
