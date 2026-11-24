/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import type { Page } from 'playwright-core';

import { wavFixture } from '../../native/soundscaper-tracktion/tests/wave_fixture.ts';

export async function verifyTracktionWebEditor(page: Page, origin: string): Promise<void> {
	const name = 'Tracktion browser project';
	const fileMenu = page.getByText('File', { exact: true });
	const button = (label: string) => page.getByRole('button', { name: label, exact: true });
	async function fileCommand(label: string): Promise<void> {
		if (await fileMenu.locator('..').getAttribute('open') === null) await fileMenu.click();
		await button(label).click();
	}
	await page.goto(`${origin}/editor`);
	await page.getByRole('heading', { name: 'Soundscaper Tracktion' }).waitFor();
	const nameProject = page.waitForEvent('dialog').then((dialog) => dialog.accept(name));
	await Promise.all([nameProject, fileCommand('New project')]);
	await page.getByRole('heading', { name }).waitFor();
	const keepProject = page.waitForEvent('dialog').then((dialog) => dialog.dismiss());
	await Promise.all([keepProject, fileCommand('Close project')]);
	await page.getByRole('heading', { name }).waitFor();
	const upload = page.waitForEvent('filechooser').then((chooser) => chooser.setFiles({
		name: 'Tracktion web media.wav', mimeType: 'audio/wav', buffer: wavFixture(1024),
	}));
	await Promise.all([upload, fileCommand('Import audio')]);
	const clip = page.getByText('Tracktion web media (0–1024)', { exact: true });
	await clip.waitFor();
	await fileCommand('Save project');
	await page.getByRole('status').filter({ hasText: 'All changes saved locally' }).waitFor();
	await page.reload();
	await fileCommand('Open projects');
	await page.getByRole('dialog', { name: 'Local projects' }).getByRole('button', { name }).click();
	await clip.waitFor();
	const [audio] = await Promise.all([page.waitForEvent('download'), fileCommand('Export mix (WAV)')]);
	assert.equal(audio.suggestedFilename().replaceAll('_', ' '), `${name}.wav`);
	assert.equal((await readFile(await audio.path())).subarray(0, 4).toString('ascii'), 'RIFF');
	const [archive] = await Promise.all([page.waitForEvent('download'), fileCommand('Export project archive (ZIP)')]);
	assert.equal(archive.suggestedFilename().replaceAll('_', ' '), `${name}.zip`);
	assert.equal((await readFile(await archive.path())).readUInt32LE(0), 0x04034b50);
}
