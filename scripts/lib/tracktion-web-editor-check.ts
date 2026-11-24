/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import type { Page } from 'playwright-core';

import { wavFixture } from '../../native/soundscaper-tracktion/tests/wave_fixture.ts';

type PlaybackWindow = Window & { tracktionTestAnalyser?: AnalyserNode; tracktionTestStarts?: number };

export async function verifyTracktionWebEditor(page: Page, origin: string): Promise<void> {
	const name = 'Tracktion browser project';
	const fileMenu = page.getByText('File', { exact: true });
	const button = (label: string) => page.getByRole('button', { name: label, exact: true });
	async function fileCommand(label: string): Promise<void> {
		if (await fileMenu.locator('..').getAttribute('open') === null) await fileMenu.click();
		await button(label).click();
	}
	await page.addInitScript(() => {
		if (!window.AudioWorkletNode) return;
		class ObservedWorklet extends AudioWorkletNode {
			constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
				super(context, name, options);
				const analyser = context.createAnalyser();
				this.connect(analyser);
				const observed = window as PlaybackWindow;
				observed.tracktionTestAnalyser = analyser;
				observed.tracktionTestStarts = (observed.tracktionTestStarts ?? 0) + 1;
			}
		}
		window.AudioWorkletNode = ObservedWorklet;
	});
	await page.goto(`${origin}/editor`);
	await page.getByRole('heading', { name: 'Soundscaper Tracktion' }).waitFor();
	const nameProject = page.waitForEvent('dialog').then((dialog) => dialog.accept(name));
	await Promise.all([nameProject, fileCommand('New project')]);
	await page.getByRole('heading', { name }).waitFor();
	const keepProject = page.waitForEvent('dialog').then((dialog) => dialog.dismiss());
	await Promise.all([keepProject, fileCommand('Close project')]);
	await page.getByRole('heading', { name }).waitFor();
	const upload = page.waitForEvent('filechooser').then((chooser) => chooser.setFiles({
		name: 'Tracktion web media.wav', mimeType: 'audio/wav', buffer: wavFixture(96_000),
	}));
	await Promise.all([upload, fileCommand('Import audio')]);
	await page.getByText('Tracktion web media (0–96000)', { exact: true }).waitFor();
	const transport = page.getByText('Playback and recording', { exact: true });
	await transport.click();
	await button('Play').click();
	try {
		await page.getByRole('status').filter({ hasText: 'Playing' }).waitFor({ timeout: 12_000 });
	} catch (cause) {
		const details = await page.getByRole('alert').allTextContents();
		throw new Error(`Tracktion browser playback did not start. ${details.join(' ')}`, { cause });
	}
	await page.waitForFunction(() => {
		const analyser = (window as PlaybackWindow).tracktionTestAnalyser;
		if (!analyser) return false;
		const samples = new Float32Array(analyser.fftSize);
		analyser.getFloatTimeDomainData(samples);
		return samples.some((sample) => Math.abs(sample) >= 0.025);
	}, undefined, { timeout: 5_000 });
	await transport.click();
	await button('Jump to project start').click();
	await page.waitForFunction(() => (window as PlaybackWindow).tracktionTestStarts === 2);
	await transport.click();
	await button('Stop').click();
	await page.getByRole('status').filter({ hasText: 'Stopped' }).waitFor();
	const editing = page.getByText('Editing tools', { exact: true });
	await editing.click();
	await button('Split clip').click();
	const split = page.getByRole('dialog', { name: 'Split clip' });
	await split.getByRole('spinbutton', { name: 'Split frame' }).fill('512');
	await split.getByRole('button', { name: 'Apply' }).click();
	await page.getByText('2 clips', { exact: true }).waitFor();
	await editing.click();
	await button('Undo').click();
	await page.getByText('1 clip', { exact: true }).waitFor();
	await editing.click();
	await button('Trim clip').click();
	const trim = page.getByRole('dialog', { name: 'Trim clip' });
	await trim.getByRole('spinbutton', { name: 'Start frame' }).fill('128');
	await trim.getByRole('spinbutton', { name: 'End frame' }).fill('896');
	await trim.getByRole('button', { name: 'Apply' }).click();
	const clip = page.getByText('Tracktion web media (128–896)', { exact: true });
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
	const portable = await readFile(await archive.path());
	assert.equal(portable.readUInt32LE(0), 0x04034b50);
	const reopenArchive = page.waitForEvent('filechooser').then((chooser) => chooser.setFiles({
		name: 'Portable copy.zip', mimeType: 'application/zip', buffer: portable,
	}));
	await Promise.all([reopenArchive, fileCommand('Open project archive (ZIP)')]);
	await page.getByRole('heading', { name: 'Portable copy' }).waitFor();
	await clip.waitFor();
}
