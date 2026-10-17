/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { encodeDedicatedAudioPcm } from '../../../src/common/editor/browser-dedicated-audio-codec.ts';
import { encodeAiff } from '../../../src/common/editor/aiff.js';
import { aup4NativeRichFixture, createAup3Fixture, createWavFixture, expect, test } from '../audio-editor-test-fixtures.js';
import { chooseFileAction, disableNativeSavePicker } from '../audio-editor-test-helpers.js';

import { connect, providerOrigin } from './audiocity-test-helpers.js';

test('connects through real OAuth, uploads and searches audio, streams playback, restores and disconnects', async ({ page }) => {
	const externalProviderRequests = [];
	page.context().on('request', request => {
		if (['api.audio.com', 'audio.com', 's3.audio.com', 's3.ustatik.com'].includes(new URL(request.url()).hostname)) externalProviderRequests.push(request.url());
	});
	const { editor, panel } = await connect(page);
	const uploads = panel.locator('[data-audiocom-uploads]');
	await uploads.locator('summary').click();
	const file = createWavFixture({ name: 'validation-tone.wav', frequency: 440, duration: 2, channelCount: 1 });
	await uploads.locator('input[type="file"]').setInputFiles(file);
	await uploads.getByRole('button', { name: /^Publish\s*: validation-tone\.wav$/u }).click();
	const dialog = page.locator('[data-audiocom-publish-dialog]');
	await dialog.locator('[name="title"]').fill('Audiocity validation tone');
	await dialog.locator('[name="visibility"]').selectOption('listed');
	await dialog.locator('[name="rightsConfirmed"]').check();
	const uploadResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/audiocom/uploads' && response.request().method() === 'POST');
	await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
	expect((await uploadResponse).status()).toBe(201);
	await expect(uploads.locator('[data-upload-status="complete"]')).toBeVisible();
	const recordingLink = uploads.getByRole('link', { name: 'Open on Audiocity', exact: true });
	await expect(recordingLink).toHaveAttribute('href', new RegExp(`^${providerOrigin}/audio/[a-f0-9-]+/play$`, 'u'));
	const listener = await page.context().newPage();
	try {
		await listener.goto(await recordingLink.getAttribute('href'));
		await expect(listener.getByRole('heading', { name: 'Audiocity validation tone', exact: true })).toBeVisible();
	} finally { await listener.close(); }
	await panel.getByRole('searchbox', { name: 'Search Audiocity', exact: true }).fill('Audiocity validation tone');
	await panel.getByRole('button', { name: 'Search', exact: true }).click();
	const result = panel.locator('[data-audiocom-audio-id]').filter({ hasText: 'Audiocity validation tone' });
	await expect(result).toContainText('0:02');
	const previewResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/audiocom/preview');
	await result.getByRole('button', { name: 'Play preview: Audiocity validation tone', exact: true }).click();
	const preview = await previewResponse;
	expect([200, 206]).toContain(preview.status());
	expect(preview.headers()['content-type']).toBe('audio/wav');
	await expect(result.getByRole('button', { name: 'Stop preview: Audiocity validation tone', exact: true })).toBeVisible();
	await result.getByRole('button', { name: 'Stop preview: Audiocity validation tone', exact: true }).click();
	await page.reload();
	await expect(panel.getByText('Connected to Audiocity', { exact: true })).toBeVisible();
	await panel.getByRole('button', { name: 'Disconnect', exact: true }).click();
	await expect(panel.getByRole('button', { name: 'Connect to Audiocity', exact: true })).toBeVisible();
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	expect(externalProviderRequests).toEqual([]);
});

for (const format of ['wv', 'aiff']) test(`previews Audiocity's original ${format} audio without server transcoding`, async ({ page }) => {
	await page.addInitScript(() => {
		const play = HTMLMediaElement.prototype.play;
		HTMLMediaElement.prototype.play = function () {
			globalThis.audiocityPreviewElement = this;
			return play.call(this);
		};
	});
	const { panel } = await connect(page);
	const uploads = panel.locator('[data-audiocom-uploads]');
	await uploads.locator('summary').click();
	const frames = 96_000;
	const samples = Float32Array.from({ length: frames }, (_value, index) => Math.sin(index * 2 * Math.PI * 440 / 48_000) * 0.2);
	const bytes = format === 'wv'
		? await encodeDedicatedAudioPcm({ format: 'wavpack', input: new Uint8Array(samples.buffer), frameCount: frames,
			channelCount: 1, sampleRate: 48_000, settings: { compressionLevel: 2 }, maximumOutputBytes: 1_000_000,
		}, { loadPayload: async (_kind, url) => new Uint8Array(await readFile(url)) })
		: new Uint8Array(encodeAiff([samples], { sampleRate: 48_000, bitDepth: 16 }));
	await uploads.locator('input[type="file"]').setInputFiles({ name: `original.${format}`, mimeType: format === 'wv' ? 'audio/x-wavpack' : 'audio/aiff', buffer: Buffer.from(bytes) });
	await uploads.getByRole('button', { name: new RegExp(`^Publish\\s*: original\\.${format}$`, 'u') }).click();
	const dialog = page.locator('[data-audiocom-publish-dialog]');
	const title = `Audiocity original ${format}`;
	await dialog.locator('[name="title"]').fill(title);
	await dialog.locator('[name="visibility"]').selectOption('listed');
	await dialog.locator('[name="rightsConfirmed"]').check();
	await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
	await expect(uploads.locator('[data-upload-status="complete"]')).toBeVisible();
	await panel.getByRole('searchbox', { name: 'Search Audiocity', exact: true }).fill(title);
	await panel.getByRole('button', { name: 'Search', exact: true }).click();
	await panel.getByRole('button', { name: `Play preview: ${title}`, exact: true }).click();
	await expect.poll(() => page.evaluate(() => {
		const audio = globalThis.audiocityPreviewElement;
		return Boolean(audio && !audio.paused && audio.currentTime > 0);
	})).toBe(true);
	await panel.getByRole('button', { name: `Stop preview: ${title}`, exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.audiocityPreviewElement?.paused)).toBe(true);
});

for (const format of ['aup3', 'aup4']) test(`stores and retrieves a real ${format.toUpperCase()} archive and opens the downloaded project`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const { editor, panel } = await connect(page, { format });
	const bytes = Buffer.from(format === 'aup3' ? await createAup3Fixture() : aup4NativeRichFixture());
	const chooser = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await chooser).setFiles({ name: `validation-${format}.${format}`, mimeType: 'application/x-audacity-project', buffer: bytes });
	await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
	const archives = panel.locator('[data-audiocom-projects]');
	await archives.locator('summary').click();
	const upload = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/audiocom/projects');
	await panel.getByRole('button', { name: 'Save project', exact: true }).click();
	const uploaded = (await upload).postDataBuffer();
	await expect(archives.getByText(`Stored validation-${format}.${format}.`, { exact: true })).toBeVisible();
	const project = archives.locator('[data-audiocom-project-id]').filter({ hasText: `validation-${format}` });
	await expect(project).toContainText(format.toUpperCase());
	const downloadEvent = page.waitForEvent('download');
	await project.getByRole('button', { name: /^Download project/u }).click();
	const download = await downloadEvent;
	expect(download.suggestedFilename()).toBe(`validation-${format}.${format}`);
	const downloaded = await readFile(await download.path());
	expect(hash(downloaded)).toBe(hash(uploaded));
	const reopen = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await reopen).setFiles({ name: download.suggestedFilename(), mimeType: 'application/x-audacity-project', buffer: downloaded });
	await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
	await expect(editor).toHaveAttribute('data-track-count', format === 'aup3' ? '1' : '2');
	await expect(editor).toHaveAttribute('data-clip-count', format === 'aup3' ? '1' : '5');
});


function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
