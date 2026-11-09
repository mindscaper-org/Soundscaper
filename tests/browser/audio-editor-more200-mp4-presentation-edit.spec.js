/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, sourcePeakChannels, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { editedM4aFixture } from '../helpers/ordinary-tail-m4a-fixture.ts';

// Node closes invalid-edit refusal/recovery and queue admission. Every valid AAC
// input still decodes natively; share only the editor initialization and Save.
test('native File Import preserves every supported MP4 presentation programme', async ({ page }) => {
	const caseTimeout = test.info().timeout;
	const fixtures = await Promise.all(['none', 'trim', 'offset', 'empty-first', 'version1'].map(mode => editedM4aFixture(mode)));
	test.setTimeout(caseTimeout * fixtures.length);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-import-input]').setInputFiles(await Promise.all(fixtures.map(async ({ file }) => ({
		name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()),
	}))));
	await expect(editor).toHaveAttribute('data-clip-count', String(fixtures.length), { timeout: 30_000 * fixtures.length });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const download = await downloading; let document;
	try { document = JSON.parse(strFromU8(unzipSync(await downloadBytes(download))['project.json'])); }
	finally { await download.delete(); }
	expect(document.sources).toHaveLength(fixtures.length); expect(document.clips).toHaveLength(fixtures.length);
	for (const { file, durationSeconds } of fixtures) await test.step(`native presentation ${file.name}`, async () => {
		const source = document.sources.find(source => source.name === file.name); expect(source).toBeDefined();
		expect(source.sampleRate).toBe(44_100); expect(source.frameCount).toBe(Math.round(durationSeconds * 44_100));
		const clip = document.clips.find(clip => clip.sourceId === source.id); expect(clip).toBeDefined();
		expect(clip.durationFrames).toBe(Math.round(source.frameCount * document.sampleRate / source.sampleRate));
		await expect.poll(async () => (await sourcePeakChannels(page, file.name)).channelCount).toBe(2);
		const peak = await sourcePeakChannels(page, file.name); expect(peak.channels[0].maximum).toBeGreaterThan(.005);
	}, { timeout: caseTimeout });
});

for (const mode of ['multiple']) test(`File Import refuses ${mode} MP4 edits and remains ready to import a flattened recording`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const unsupported = await editedM4aFixture(mode);
	await editor.locator('[data-import-input]').setInputFiles({ name: unsupported.file.name, mimeType: unsupported.file.type,
		buffer: Buffer.from(await unsupported.file.arrayBuffer()) });
	await expect(editor.locator('[data-editor-toast="workspace-status-error"]')).toContainText(/edit list.*Flatten or render/iu, { timeout: 30_000 });
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	const healthy = await editedM4aFixture('none');
	await editor.locator('[data-import-input]').setInputFiles({ name: healthy.file.name, mimeType: healthy.file.type,
		buffer: Buffer.from(await healthy.file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
});

test('Freesound natively posts only each supported MP4 presentation programme', async ({ page }) => {
	const caseTimeout = test.info().timeout; test.setTimeout(caseTimeout * 3);
	await observeUploads(page);
	const uploads = await openUploadArea(page);
	for (const [index, mode] of ['trim', 'offset', 'empty-first'].entries()) await test.step(`native upload ${mode}`, async () => {
		const { file, durationSeconds } = await editedM4aFixture(mode);
		await uploads.locator('input[type="file"]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
		await expect(uploads.locator('li')).toHaveCount(index + 1);
		await expect(uploads.locator('li').nth(index)).toHaveAttribute('data-upload-status', 'ready-to-publish', { timeout: 30_000 });
		const bodies = await page.evaluate(() => globalThis.__presentationUploadBodies); expect(bodies).toHaveLength(index + 1);
		const output = new Blob([Buffer.from(bodies[index], 'base64')]);
		const descriptor = await inspectWavBlobPcm(output);
		expect(descriptor.frameCount).toBe(Math.round(durationSeconds * descriptor.sampleRate)); expect(descriptor.channelCount).toBe(2);
		let maximum = 0;
		await streamWavBlobPcm(output, { onChunk(channels) { for (const channel of channels) for (const sample of channel) maximum = Math.max(maximum, Math.abs(sample)); } });
		expect(maximum).toBeGreaterThan(.005);
	}, { timeout: caseTimeout });
});

for (const mode of ['all-empty']) test(`Freesound refuses ${mode} edits before posting retained media`, async ({ page }) => {
	await observeUploads(page);
	const { file } = await editedM4aFixture(mode);
	const uploads = await openUploadArea(page);
	await uploads.locator('input[type="file"]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(uploads.locator('li')).toHaveAttribute('data-upload-status', 'failed', { timeout: 30_000 });
	await expect(uploads.locator('li')).toContainText('The audio could not be prepared for upload.');
	expect(await page.evaluate(() => globalThis.__presentationUploadBodies)).toEqual([]);
});

async function observeUploads(page) {
	await page.addInitScript(() => {
		globalThis.__presentationUploadBodies = [];
		const nativeFetch = globalThis.fetch;
		globalThis.fetch = async (input, init) => {
			if (new URL(String(input), location.href).pathname === '/api/freesound/uploads' && init?.body instanceof Blob) {
				const bytes = new Uint8Array(await init.body.arrayBuffer());
				let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
				globalThis.__presentationUploadBodies.push(btoa(binary));
			}
			return Reflect.apply(nativeFetch, globalThis, [input, init]);
		};
	});
	await page.route('**/api/freesound/**', async route => {
		const path = new URL(route.request().url()).pathname;
		const data = path.endsWith('/oauth/session') ? { connected: true, user: { username: 'fixture' } }
			: path.endsWith('/uploads/pending') ? { pendingDescription: [], pendingProcessing: [], pendingModeration: [] }
				: { uploadFilename: 'presented-programme.wav' };
		await route.fulfill({ json: { data } });
	});
}

async function openUploadArea(page) {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Window', ['Freesound']);
	const uploads = editor.locator('[data-freesound-uploads="true"]');
	await uploads.getByText('Upload to Freesound', { exact: true }).click();
	return uploads;
}
