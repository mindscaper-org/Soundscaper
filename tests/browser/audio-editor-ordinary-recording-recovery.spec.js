/* SPDX-License-Identifier: AGPL-3.0-only */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { readWavePcm } from '../helpers/read-wave-pcm.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, disableNativeSavePicker, downloadBytes, openExportDialog, registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { createPackagedRuntimeAudioWave, packagedRuntimeAudioArguments } from './helpers/packaged-runtime-audio-fixture.js';

// Coverage instrumentation competes with realtime capture on bounded CI runners.
test.use({ browserCoverage: false });
registerAudioEditorHooks();

test('ordinary recording survives a renderer crash with its saved checkpoints and exports the recovered audio', async ({ browserName, baseURL }) => {
	test.skip(browserName !== 'chromium', 'The renderer crash witness uses Chromium CDP and a persistent profile.');
	test.setTimeout(180_000);
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-recording-recovery-'));
	const input = join(directory, 'capture.wav');
	await writeFile(input, createPackagedRuntimeAudioWave());
	let context = await launch(directory, baseURL, input);
	try {
		let page = context.pages()[0] ?? await context.newPage();
		let editor = await bootEditor(page, '/embed/en/');
		const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
		await record.click();
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		await expect.poll(async () => (await durableRecording(page)).checkpointCount, { timeout: 60_000, message: 'two ordinary checkpoints become durable before the renderer crash' }).toBeGreaterThanOrEqual(2);
		const before = await durableRecording(page);
		expect(before.journalCount).toBe(1);
		expect(before.missingSources).toEqual([]);
		expect(before.clipCount).toBe(0);
		const crash = page.waitForEvent('crash');
		const cdp = await context.newCDPSession(page);
		void cdp.send('Page.crash').catch(() => undefined);
		await crash;
		await context.close();
		context = await launch(directory, baseURL, input);
		page = context.pages()[0] ?? await context.newPage();
		await disableNativeSavePicker(page);
		await page.goto('/embed/en/');
		editor = page.locator('[data-audio-editor]');
		await expect(editor).toBeVisible();
		const dialog = page.getByRole('dialog', { name: 'Interrupted recording', exact: true });
		await expect(dialog).toBeVisible({ timeout: 30_000 });
		await expect(dialog.getByRole('button', { name: 'Recover recording', exact: true })).toBeFocused();
		await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
		await expect(dialog).toBeHidden();
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		await page.getByRole('dialog', { name: 'Record options', exact: true }).getByRole('button', { name: 'Resolve interrupted recording', exact: true }).click();
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Recover recording', exact: true }).click();
		await expect(dialog).toBeHidden({ timeout: 30_000 });
		await expect.poll(async () => (await durableRecording(page)).journalCount, { timeout: 30_000 }).toBe(0);
		const after = await durableRecording(page);
		expect(after.clipCount).toBe(before.checkpointCount);
		expect(after.projectSourceIds.sort()).toEqual(before.sourceIds.sort());
		expect(after.totalClipFrames).toBe(before.expectedTimelineFrames);

		const exported = await openExportDialog(page, editor);
		await chooseDropdown(page, exported.locator('[data-export-field="format"]'), 'WAV');
		await chooseDropdown(page, exported.locator('[data-export-field="bitDepth"]'), '16-bit PCM');
		await exported.getByRole('button', { name: 'Export', exact: true }).click();
		const link = exported.locator('[data-export-download]');
		await expect(link).toBeVisible({ timeout: 30_000 });
		const download = page.waitForEvent('download'); await link.click();
		const bytes = await downloadBytes(await download);
		const { sampleRate, channels: [samples] } = readWavePcm(bytes);
		expect(samples.length).toBe(after.projectEndFrame);
		const window = samples.subarray(sampleRate, Math.round(1.5 * sampleRate));
		expect(window.length).toBe(Math.round(sampleRate / 2));
		expect(Math.sqrt(window.reduce((energy, sample) => energy + sample ** 2, 0) / window.length)).toBeGreaterThan(0.05);
		expect(Math.abs(recordedToneFrequency(window, sampleRate) - 440)).toBeLessThan(4);
		await exported.getByRole('button', { name: 'Close', exact: true }).last().click();

		// An ordinary Stop must settle the same journal without a restart prompt.
		await editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button').click();
		await expect.poll(async () => (await durableRecording(page)).journalCount).toBe(1);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect.poll(async () => (await durableRecording(page)).journalCount, { timeout: 30_000 }).toBe(0);
	} finally {
		await context.close().catch(() => undefined);
		await rm(directory, { recursive: true, force: true });
	}
});

function recordedToneFrequency(samples, sampleRate) {
	// Comparing nearby periods across the window avoids counting capture glitches
	// or extra zero crossings at recovered checkpoint boundaries as new cycles.
	let bestLag = 0;
	let bestError = Infinity;
	const maximumLag = Math.ceil(sampleRate / 350);
	for (let lag = Math.floor(sampleRate / 530); lag <= maximumLag; lag++) {
		let error = 0;
		for (let frame = maximumLag; frame < samples.length; frame++) error += (samples[frame] - samples[frame - lag]) ** 2;
		if (error < bestError) {
			bestError = error;
			bestLag = lag;
		}
	}
	return sampleRate / bestLag;
}

async function launch(directory, baseURL, input) {
	const context = await chromium.launchPersistentContext(directory, {
		baseURL, headless: true, permissions: ['microphone'], serviceWorkers: 'block',
		args: [...packagedRuntimeAudioArguments(input), '--use-fake-ui-for-media-stream'],
	});
	await context.addInitScript(() => {
		Object.defineProperty(navigator.storage, 'estimate', { configurable: true,
			value: () => Promise.resolve({ usage: 1024 ** 2, quota: 2 * 1024 ** 3 }) });
	});
	return context;
}

async function durableRecording(page) {
	return page.evaluate(async (databaseName) => {
		const request = (operation) => new Promise((resolve, reject) => { operation.onsuccess = () => resolve(operation.result); operation.onerror = () => reject(operation.error); });
		const database = await request(indexedDB.open(databaseName));
		try {
			const transaction = database.transaction(['analysis', 'projects', 'sources'], 'readonly');
			const [analysis, projects, sources] = await Promise.all([
				request(transaction.objectStore('analysis').getAll()), request(transaction.objectStore('projects').getAll()), request(transaction.objectStore('sources').getAll()),
			]);
			const journals = analysis.filter(({ key }) => key.startsWith('recording-recovery-v1:')).map(({ value }) => value);
			const project = projects.find(({ id }) => id === journals[0]?.projectId) ?? projects[0];
			const lanes = journals.flatMap(({ lanes }) => lanes);
			const segments = lanes.flatMap(({ segments }) => segments);
			const sourceIds = segments.map(({ sourceId }) => sourceId);
			const expectedTimelineFrames = lanes.reduce((sum, { destination, segments }) => sum + Math.round(Math.max(0,
				segments.reduce((count, { frameCount }) => count + frameCount, 0) - destination.sourceOffsetFrames) * project.sampleRate / destination.sampleRate), 0);
			return { journalCount: journals.length, checkpointCount: segments.length, sourceIds, expectedTimelineFrames,
				missingSources: sourceIds.filter((id) => !sources.some((source) => source.id === id)),
				clipCount: project.clips.length, projectSourceIds: project.sources.map(({ id }) => id),
				totalClipFrames: project.clips.reduce((sum, { durationFrames }) => sum + durationFrames, 0),
				projectEndFrame: Math.max(0, ...project.clips.map(({ timelineStartFrame, durationFrames }) => timelineStartFrame + durationFrames)) };
		} finally { database.close(); }
	}, SOUNDSCAPER_DATABASE_NAME);
}
