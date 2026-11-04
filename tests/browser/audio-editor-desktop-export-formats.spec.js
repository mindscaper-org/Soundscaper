/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, importFiles, openExportDialog } from './audio-editor-test-helpers.js';
import { installDesktopSpeedWarmupManifest } from './helpers/desktop-speed-warmup-fixture.js';

async function installCodecBridge(page, mode) {
	await installDesktopSpeedWarmupManifest(page);
	await page.addInitScript(({ mode }) => {
		const state = { installed: mode !== 'missing', installations: 0, queries: [], mode };
		globalThis.__exportCodecFixture = state;
		const status = () => ({
			state: state.installed ? 'ready' : 'unconfigured', canInstall: true,
			location: state.installed ? '/usr/bin/ffmpeg' : null, detail: '',
		});
		Object.defineProperty(globalThis, 'soundscaperDesktop', { configurable: true, value: { v1: {
			getExternalFfmpegStatus: async () => status(),
			installExternalFfmpeg: async () => { state.installations += 1; state.installed = true; return status(); },
			getDesktopAudioCodecCapabilities: async query => {
				state.queries.push(query);
				if (state.mode === 'probe-failed') throw new Error('Invalid desktop audio codec capability response');
				return { schemaVersion: 2, capabilities: query.operations.map(tuple => {
					if (tuple.format === 'mp3' && ![8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000].includes(tuple.sampleRate)) {
						return { ...tuple, available: false, provider: null, reason: 'unsupported-settings' };
					}
					const unavailable = !state.installed || (state.mode === 'unsupported' && tuple.format === 'flac');
					return { ...tuple, available: !unavailable, provider: unavailable ? null : 'bundled',
						reason: !unavailable ? null : state.installed ? 'unsupported-by-configured-ffmpeg' : 'configure-external-ffmpeg',
						...(state.mode === 'unsupported' && tuple.format === 'flac' ? { missingCapabilities: ['encoder:flac'] } : {}),
					};
				}) };
			},
		} } });
	}, { mode });
}

test('all audio formats remain visible and missing FFmpeg can be installed from selection', async ({ page }) => {
	await installCodecBridge(page, 'missing');
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const dialog = await openExportDialog(page, editor);
	await expect(dialog.getByText(/Configure FFmpeg/u)).toHaveCount(0);
	const formats = dialog.locator('[data-export-field="format"]');
	await formats.getByRole('button').click();
	for (const name of ['WAV', 'FLAC', 'MP3', 'Ogg Vorbis', 'Opus', 'WavPack', 'MP2', 'AAC / M4A']) {
		await expect(page.getByRole('option', { name, exact: true })).toBeVisible();
	}
	await page.getByRole('option', { name: 'AAC / M4A', exact: true }).click();
	const dependency = page.getByRole('alertdialog', { name: 'FFmpeg is not installed', exact: true });
	await expect(dependency).toContainText('AAC / M4A export requires FFmpeg');
	await expect.poll(() => page.evaluate(() => globalThis.__exportCodecFixture.installations)).toBe(0);
	await dependency.getByRole('button', { name: 'Install FFmpeg', exact: true }).click();
	await expect(dependency).toHaveCount(0);
	await expect(formats.getByRole('button')).toContainText('AAC / M4A');
	await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
	await expect.poll(() => page.evaluate(() => globalThis.__exportCodecFixture.installations)).toBe(1);
});

test('an installed FFmpeg reports the missing encoder on selection without hiding formats', async ({ page }) => {
	await installCodecBridge(page, 'unsupported');
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'FLAC');
	const problem = page.getByRole('alertdialog', { name: 'FLAC export unavailable', exact: true });
	await expect(problem).toContainText('encoder:flac');
	await expect(problem.getByRole('button', { name: 'Install FFmpeg' })).toHaveCount(0);
	await problem.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeDisabled();
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'MP3');
	await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
	await expect(page.getByRole('alertdialog')).toHaveCount(0);
	await expect.poll(() => page.evaluate(() => globalThis.__exportCodecFixture.queries.at(-1).operations[0].settings)).toEqual({ preset: 2 });
});

test('a codec bridge failure reports its actual error without claiming FFmpeg is missing', async ({ page }) => {
	await installCodecBridge(page, 'probe-failed');
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'Opus');
	const problem = page.getByRole('alertdialog', { name: 'Opus export unavailable', exact: true });
	await expect(problem).toContainText('Invalid desktop audio codec capability response');
	await expect(problem.getByRole('button', { name: 'Install FFmpeg' })).toHaveCount(0);
	await problem.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
	await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
});

test('editing the sample rate does not interrupt typing with a capability error', async ({ page }) => {
	await installCodecBridge(page, 'available');
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'MP3');
	const rate = dialog.getByRole('spinbutton');
	await rate.fill('');
	await rate.pressSequentially('96000');
	await expect(page.getByRole('alertdialog')).toHaveCount(0);
	await rate.press('Tab');
	const problem = page.getByRole('alertdialog', { name: 'MP3 export unavailable', exact: true });
	await expect(problem).toContainText('96000 Hz');
	await problem.getByRole('button', { name: 'Close', exact: true }).last().click();
	await rate.fill('48000');
	await rate.press('Tab');
	await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
});

test('desktop MP3 and M4A mixed exports offer opt-in embedded label chapters', async ({ page }) => {
	await installCodecBridge(page, 'available');
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Add label');
	const title = editor.getByRole('textbox', { name: /^Edit labels:/u });
	await title.fill('Opening chapter');
	await title.press('Enter');
	const dialog = await openExportDialog(page, editor);
	const chapters = dialog.getByRole('checkbox', { name: 'Embed labels as chapters', exact: true });
	await expect(chapters).toHaveCount(0);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'MP3');
	await expect(chapters).not.toBeChecked();
	await chapters.check();
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'AAC / M4A');
	await expect(chapters).toBeChecked();
	await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), 'Individual stems (split by tracks)');
	await expect(chapters).toHaveCount(0);
});
