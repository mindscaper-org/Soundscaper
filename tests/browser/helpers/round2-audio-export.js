/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '../audio-editor-test-fixtures.js';
import { commitInput, openExportDialog, readDownloadBytes } from '../audio-editor-test-helpers.js';
import { readWavePcm } from '../../helpers/read-wave-pcm.ts';

export async function exportSamples(page, editor, { sampleRate, includeTail, renderTimeout = 20_000 } = {}) {
	const dialog = await openExportDialog(page, editor);
	if (sampleRate !== undefined) await commitInput(dialog.locator('[data-export-field="sampleRate"] input'), String(sampleRate));
	if (includeTail !== undefined) await dialog.getByRole('checkbox', { name: /^Include effect tails/u }).setChecked(includeTail);
	const link = dialog.locator('[data-export-download]');
	const previousDownload = await link.getAttribute('href');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect.poll(async () => {
		if (!await link.isVisible()) return false;
		const href = await link.getAttribute('href');
		return Boolean(href && href !== '#' && href !== previousDownload);
	}, { timeout: renderTimeout }).toBe(true);
	const bytes = await readDownloadBytes(page, link);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(dialog).toBeHidden();
	const decoded = readWavePcm(bytes);
	if (decoded.sampleRate === 48_000) return Array.from(decoded.channels[0]);
	// Other callers deliberately deliver at a different clock. Preserve their
	// existing native 48kHz resampling oracle, without paying for it on every WAV.
	return page.evaluate(async data => {
		const context = new OfflineAudioContext(1, 1, 48_000);
		const audio = await context.decodeAudioData(Uint8Array.from(data).buffer);
		return Array.from(audio.getChannelData(0));
	}, Array.from(bytes));
}
