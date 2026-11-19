/* SPDX-License-Identifier: AGPL-3.0-only */

import { rm } from 'node:fs/promises';
import { setClipTimeFrames } from './audio-editor-clip-timing-test-helpers.js';
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, chooseDropdown, chooseExportProjectFileAction, chooseFileAction,
	chooseNestedCommandAction, clipByName, closeClipProperties, closeDialog, commitInput, disableNativeSavePicker,
	downloadBytes, importFiles, openClipProperties, openExportDialog, openTrackHeaderDrawer, showClipTimingFields, waitForProjectActivation,
} from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { readWavePcm } from '../helpers/read-wave-pcm.ts';

const stereo = createWavFixture({ name: 'mixed-width-stereo.wav', frequency: 330 });
const mono = createWavFixture({ name: 'mixed-width-mono.wav', frequency: 440, channelCount: 1 });
const rms = samples => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);

test('splitting a mixed mono and stereo track preserves each recording level', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [stereo, mono]);
	const source = clipByName(editor, mono.name);
	const destination = clipByName(editor, stereo.name).locator('xpath=ancestor::*[@data-track-row][1]');
	const destinationId = await destination.getAttribute('data-track-id');
	const properties = await openClipProperties(page, editor, source);
	await showClipTimingFields(properties);
	await setClipTimeFrames(properties, 'startFrame', 48000);
	await closeClipProperties(properties);
	const clipBox = await source.boundingBox(), trackBox = await destination.boundingBox();
	expect(clipBox).not.toBeNull(); expect(trackBox).not.toBeNull();
	// Move vertically at the existing timeline position; Ctrl now duplicates.
	await page.mouse.move(clipBox.x + 32, clipBox.y + 10);
	await page.mouse.down();
	await page.mouse.move(clipBox.x + 32, trackBox.y + 60, { steps: 8 });
	await page.mouse.up();
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(source.locator('xpath=ancestor::*[@data-track-row][1]')).toHaveAttribute('data-track-id', destinationId);
	const before = await exportSamples(page, editor);
	await chooseTrackMenuAction(page, editor, destination, ['Track channels', 'Split stereo to left/right mono']);
	await expect(editor).toHaveAttribute('data-clip-count', '4');
	const after = await exportSamples(page, editor);
	expect(rms(after.slice(55_200, 64_800))).toBeCloseTo(rms(before.slice(55_200, 64_800)), 4);
	expect(rms(after.slice(7_200, 16_800))).toBeCloseTo(rms(before.slice(7_200, 16_800)), 4);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	expect(rms((await exportSamples(page, editor)).slice(55_200, 64_800))).toBeCloseTo(rms(before.slice(55_200, 64_800)), 4);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-clip-count', '4');
	expect(rms((await exportSamples(page, editor)).slice(55_200, 64_800))).toBeCloseTo(rms(before.slice(55_200, 64_800)), 4);
});

const stereoRackCases = [
	{ scope: 'clip', effect: 'Reverb', requireRender: true, frames: 43_680,
		title: 'a reopened stereo recording retains both channels until its stereo Reverb is rendered' },
	{ scope: 'clip', effect: 'Noise gate', requireRender: true, frames: 38_400,
		title: 'a reopened stereo recording retains both channels until its linked clip Noise gate is rendered' },
	{ scope: 'track', effect: 'Noise gate', requireRender: true, frames: 38_400,
		title: 'a reopened stereo recording retains both channels until its linked track Noise gate is rendered' },
	{ scope: 'clip', effect: 'Noise gate', requireRender: false, frames: 38_400,
		title: 'a reopened stereo recording splits with an independent Noise gate and keeps its audio' },
];

for (const { scope, effect, requireRender, frames, title } of stereoRackCases) test(title, async ({ page, browser }, result) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const name = 'Stereo radio interview';
	const channelAmplitudes = effect === 'Reverb' ? [0.12, 0.35] : [0.4, 0.02];
	const recording = createWavFixture({ name: `${name}.wav`, frequency: 330, channelAmplitudes });
	await importFiles(editor, [recording]);
	const recordingClip = clipByName(editor, recording.name);
	const rack = scope === 'clip' ? await openClipProperties(page, editor, recordingClip) : await openRecordingTrackRack(editor, recordingClip);
	if (scope === 'clip') await rack.getByText('Effects', { exact: true }).click();
	await addRackEffect(page, rack, 'track', effect);
	const settings = page.getByRole('dialog', { name: effect, exact: true });
	const parameters = effect === 'Reverb' ? { mix: '1', decay: '0.1' } : { threshold: '-20', rangeDb: '-60' };
	for (const [parameter, value] of Object.entries(parameters)) {
		await commitInput(settings.locator(`[data-effect-param="${parameter}"] input[type="number"]`), value);
	}
	if (!requireRender) await chooseDropdown(page, settings.getByRole('group', { name: 'Stereo linking', exact: true }), 'Independent channels');
	await closeDialog(settings);
	if (scope === 'clip') await closeClipProperties(rack);
	const pending = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const download = await pending;
	const path = result.outputPath(download.suggestedFilename());
	const reopenedContext = await browser.newContext({ baseURL: page.url() });
	try {
		await download.saveAs(path);
		await download.delete();
		const reopenedPage = await reopenedContext.newPage();
		await disableNativeSavePicker(reopenedPage);
		const reopened = await bootEditor(reopenedPage, '/embed/en/', { showProjectBin: false });
		const choosing = reopenedPage.waitForEvent('filechooser');
		await chooseFileAction(reopenedPage, reopened, 'Open');
		await (await choosing).setFiles(path);
		const clip = clipByName(reopened, recording.name);
		await expect(clip).toBeVisible();
		await waitForProjectActivation(reopened);
		const before = await deliverStereoWave(reopenedPage, reopened);
		if (effect === 'Noise gate') {
			expect(rms(before.channels[1].slice(12_000, 26_400))).toBeCloseTo(requireRender ? 0.014142 : 0.000014143, 7);
		}
		const split = ['Track channels', 'Split stereo to left/right mono'];
		await chooseTrackMenuAction(reopenedPage, reopened, clip.locator('xpath=ancestor::*[@data-track-row][1]'), split);
		if (!requireRender) {
			await expect(reopened).toHaveAttribute('data-clip-count', '2');
			expectMatchingStereoWave(await deliverStereoWave(reopenedPage, reopened), before, frames);
			return;
		}
		await expect(reopened.getByRole('alert')).toContainText('Use Mix & Render with Stereo output and Render effects enabled before splitting this track.');
		await expect(reopened).toHaveAttribute('data-clip-count', '1');
		expectMatchingStereoWave(await deliverStereoWave(reopenedPage, reopened), before, frames);

		await clip.locator('.clip-header').click();
		await chooseNestedCommandAction(reopenedPage, reopened, 'Tracks', ['Mix & Render']);
		const mix = reopenedPage.getByRole('dialog', { name: 'Mix & Render', exact: true });
		await mix.getByRole('button', { name: 'Mix & Render', exact: true }).click();
		await expect(mix).toBeHidden();
		const rendered = clipByName(reopened, name);
		await expect(rendered).toBeVisible();
		await chooseTrackMenuAction(reopenedPage, reopened, rendered.locator('xpath=ancestor::*[@data-track-row][1]'), split);
		await expect(reopened).toHaveAttribute('data-clip-count', '2');
		expectMatchingStereoWave(await deliverStereoWave(reopenedPage, reopened), before, frames);
	} finally {
		await reopenedContext.close();
		await rm(path, { force: true });
	}
});

async function openRecordingTrackRack(editor, clip) {
	await openTrackHeaderDrawer(editor);
	await clip.locator('xpath=ancestor::*[@data-track-row][1]').getByRole('button', { name: 'Effects', exact: true }).click();
	return editor.locator('[data-workspace-panel="effects"]');
}

async function deliverStereoWave(page, editor) {
	const dialog = await openExportDialog(page, editor);
	await dialog.getByRole('checkbox', { name: /^Include effect tails/u }).check();
	const pending = page.waitForEvent('download', download => download.suggestedFilename().endsWith('.wav'));
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const download = await pending;
	try { return readWavePcm(await downloadBytes(download)); }
	finally { await download.delete(); await closeDialog(dialog); }
}

function expectMatchingStereoWave(actual, before, frames) {
	expect(actual.sampleRate).toBe(48_000);
	expect(actual.channels).toHaveLength(2);
	for (const [channel, samples] of actual.channels.entries()) {
		expect(samples).toHaveLength(frames);
		const differences = samples.reduce((count, sample, frame) => count + Number(sample !== before.channels[channel][frame]), 0);
		expect(differences).toBe(0);
	}
}
