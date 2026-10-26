/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, chooseFileAction, clipByName, disableNativeSavePicker, downloadBytes, openExportDialog, readDownloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import { strFromU8, unzipSync } from 'fflate';

test('Generate Tone persists admitted 768 kHz PCM when its native buffer cache is unsupported', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await openEmptyProject(page, 768_000);
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const generator = page.getByRole('dialog', { name: 'Tone', exact: true });
	const duration = generator.getByRole('group', { name: 'Duration (seconds)', exact: true });
	await duration.locator('.timecode-digit').first().click();
	await page.keyboard.type('000001000'); await page.keyboard.press('Enter');
	await expect(duration.locator('.timecode__display')).toHaveText('00h00m01.000s');
	await generator.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(generator).toBeHidden({ timeout: 30_000 });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const saved = await savedProject(page, editor);
	const entries = unzipSync(saved), project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources).toHaveLength(1);
	expect(project.sources[0]).toMatchObject({ sampleRate: 768_000, frameCount: 768_000, channelCount: 2 });
	const pcm = Object.entries(entries).filter(([name]) => name.endsWith('.f32c'));
	expect(pcm).toHaveLength(1);
	const bytes = Buffer.from(pcm[0][1]);
	let offset = 0, frames = 0, peak = 0, positiveCrossings = 0, previous = 0;
	while (offset < bytes.length) {
		const count = bytes.readUInt32LE(offset); offset += 4;
		for (let frame = 0; frame < count; frame++) {
			const sample = bytes.readFloatLE(offset + frame * 4);
			peak = Math.max(peak, Math.abs(sample));
			if (frames + frame && previous <= 0 && sample > 0) positiveCrossings++;
			previous = sample;
		}
		frames += count; offset += count * 2 * 4;
	}
	expect(frames).toBe(768_000); expect(offset).toBe(bytes.length);
	expect(peak).toBeGreaterThan(0.1);
	expect(positiveCrossings).toBeGreaterThanOrEqual(439);
	expect(positiveCrossings).toBeLessThanOrEqual(441);
});

for (const sourceRate of [48_000, 768_000]) test(`a stored ${sourceRate} Hz source exports after native archive reopening`, async ({ page, browser, browserName }) => {
	await disableNativeSavePicker(page);
	const editor = await openEmptyProject(page, 48_000);
	const samples = Float32Array.from({ length: sourceRate }, (_value, frame) => 0.5 * Math.sin(2 * Math.PI * 440 * frame / sourceRate));
	await editor.locator('[data-import-input]').setInputFiles({ name: 'High rate.wav', mimeType: 'audio/wav',
		buffer: Buffer.from(encodeWav([samples], { sampleRate: sourceRate, bitDepth: 24, dither: false })) });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const firstPcm = await exportedTone(page, editor);
	await page.getByRole('dialog', { name: 'Export audio', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
	const saved = await savedProject(page, editor);
	const savedDocument = JSON.parse(strFromU8(unzipSync(saved)['project.json']));
	expect(savedDocument.sampleRate).toBe(48_000);
	expect(savedDocument.sources[0]).toMatchObject({ sampleRate: sourceRate, frameCount: sourceRate });
	await page.goto('about:blank');
	// A fresh browser store prevents a still-open project's native archive
	// collision handling from substituting its existing, already-active sources.
	const freshContext = await browser.newContext({ serviceWorkers: 'block' });
	try {
		const freshPage = await freshContext.newPage(); await disableNativeSavePicker(freshPage);
		const reopened = await bootEditor(freshPage, '/embed/en/');
		const choosing = freshPage.waitForEvent('filechooser');
		await chooseFileAction(freshPage, reopened, 'Open');
		await (await choosing).setFiles({ name: 'Stored high rate.sscape', mimeType: 'application/zip', buffer: Buffer.from(saved) });
		await expect(reopened).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
		await waitForProjectActivation(reopened);
		await freshPage.bringToFront();
		// Headless Firefox's fresh-context native resume also stalls in a plain
		// DOM-button control. All engines still verify the exact reopened PCM.
		if (browserName !== 'firefox') {
			const playhead = reopened.getByRole('slider', { name: 'Playhead', exact: true });
			await reopened.getByRole('button', { name: 'Play', exact: true }).click();
			await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(100);
			await reopened.getByRole('button', { name: 'Stop', exact: true }).click();
		}
		const reopenedPcm = await exportedTone(freshPage, reopened);
		expect(Math.abs(reopenedPcm.peak - firstPcm.peak)).toBeLessThan(0.00001);
	} finally { await freshContext.close(); }
});

test('splitting an imported high-rate stereo source keeps its immutable PCM despite native cache limits', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await openEmptyProject(page, 48_000);
	const sampleRate = 768_000;
	const channels = [440, 880].map(frequency => Float32Array.from({ length: sampleRate },
		(_value, frame) => 0.5 * Math.sin(2 * Math.PI * frequency * frame / sampleRate)));
	const name = 'High-rate stereo.wav';
	await editor.locator('[data-import-input]').setInputFiles({ name, mimeType: 'audio/wav',
		buffer: Buffer.from(encodeWav(channels, { sampleRate, bitDepth: 24, dither: false })) });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const track = clipByName(editor, name).locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, track, ['Track channels', 'Split stereo to left/right mono']);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await exportedTone(page, editor);
	await page.getByRole('dialog', { name: 'Export audio', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
	const saved = await savedProject(page, editor);
	const document = JSON.parse(strFromU8(unzipSync(saved)['project.json']));
	expect(document.clips).toHaveLength(2);
	for (const clip of document.clips) {
		const source = document.sources.find(source => source.id === clip.sourceId);
		expect(source).toMatchObject({ channelCount: 1, sampleRate, frameCount: sampleRate });
	}
});

async function openEmptyProject(page, sampleRate) {
	const project = createSoundscaperProject({ id: `more200-high-rate-${sampleRate}`, sampleRate });
	const archive = await createSoundscaperScapeNativeRuntime().exportScapeProject(project, {
		async getMediaAssetMetadata() { return null; }, async loadMediaAsset() { return null; },
		readSourceChunks() { return (async function* () {})(); },
	});
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'High rate.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await waitForProjectActivation(editor);
	return editor;
}

async function savedProject(page, editor) {
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	return downloadBytes(await downloading);
}

async function exportedTone(page, editor) {
	const dialog = await openExportDialog(page, editor);
	const rate = dialog.locator('[data-export-field="sampleRate"] input');
	// The existing WAV delivery profile offers up to 384 kHz. A supported 48 kHz
	// delivery verifies the high-rate source without expanding that profile.
	await rate.fill('48000'); await rate.press('Tab');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 30_000 });
	const bytes = Buffer.from(await readDownloadBytes(page, link));
	let format, data;
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const size = bytes.readUInt32LE(offset + 4), id = bytes.toString('ascii', offset, offset + 4);
		if (id === 'fmt ') format = bytes.subarray(offset + 8, offset + 8 + size);
		if (id === 'data') data = bytes.subarray(offset + 8, offset + 8 + size);
		offset += 8 + size + (size & 1);
	}
	expect(format).toBeDefined(); expect(data).toBeDefined();
	expect(format.readUInt32LE(4)).toBe(48_000);
	expect(format.readUInt16LE(14)).toBe(24);
	const frameBytes = format.readUInt16LE(12), frames = data.length / frameBytes;
	expect(frames).toBe(48_000);
	let peak = 0, positiveCrossings = 0, previous = 0;
	for (let frame = 0; frame < frames; frame++) {
		const sample = data.readIntLE(frame * frameBytes, 3) / 8388608;
		peak = Math.max(peak, Math.abs(sample));
		if (frame && previous <= 0 && sample > 0) positiveCrossings++;
		previous = sample;
	}
	expect(peak).toBeGreaterThan(0.1);
	expect(positiveCrossings).toBeGreaterThanOrEqual(439);
	expect(positiveCrossings).toBeLessThanOrEqual(441);
	return { peak };
}
