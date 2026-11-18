/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseDropdown,
	chooseNestedCommandAction,
	collectClientErrors,
	disableNativeSavePicker,
	importFiles,
	openExportDialog,
	readDownloadBytes,
} from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

// Pinned @ffmpeg/core 0.12.10, color=c=black:s=96x54:r=10:d=2, libvpx, g=10, yuv420p.
const CAPTION_VIDEO = [
	'eJyTcr2/eL5TWyOj0/dGRqdPjSxOnxs5nJpaylOTcp3aG5mcWhuZJIIb0hkZQID5gaDv7JJdvru7g1e3iHquTAte07gQwhML',
	'WZcdvKbxhu/unuDVLUIhh9OD1zQxykG4MsG7s4PXNDFvfwMxhyGSgVYA5KpNWtc3NvM7Ofg29PoklqWZWuoZmesZGhiEO6Ly',
	'XTo7HOY7gLWBnH9wHdR1FtcbGYuPdpx78ZQ5hoP70pxGBqWtc5pL81I6GhnaWsPiwwIsmhsZlR83t7B+fcjwoHNDY8KuRrNZ',
	'jUwgb/8tLl6QfKAh/cQs18Xtrn7O/i6uQS7tqBYXF19PPtCdjLAi/cRCZNVTfBLLkk0t9YzBqhVyMpPKCirSTyxyXdzhEhrk',
	'GOLp7+fSPsXAwAqEjPQMYICBQd55W6mT4PNGhsVrGxkYGgKYGeYyaiUwmDEwuHO0tna0tnQwMTGw+aifm2tV8vLycr+55gf+',
	'/V8d0LB4WiNDCsNFRgZWgTUMEgwSEfpfGDhaNRhA4iewizPq4BCfgEP8C3Zxpggc4nsg4gIiCQyJCfsvMCiJLACJMytgV8/c',
	'gk18bSPzC5KCgcUHu/EsG7CLs4rgEK/AIX4HuzibAw7xJdiDgZ0Du3r2HCzioAy4ZHf/5kaG7V3fGxk/NjEu+NDIvHvi5ibm',
	'F9u7YSJNjFwA2lU4DQ==',
].join('');

test('Framescaper v1 imports and exports caption files and publishes built-in motion analysis', async ({ page }) => {
	test.setTimeout(180_000);
	await disableNativeSavePicker(page);
	const clientErrors = collectClientErrors(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('v28-caption-motion.webm')]);
	await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 30_000 });
	const projectId = await editor.getAttribute('data-project-id');
	expect(projectId).toBeTruthy();

	let dialog = await openFinishing(page, editor, 'Tracks', /^Caption Tracks/u, 'Caption Tracks');
	await dialog.locator('[data-framescaper-caption-file]').setInputFiles({
		name: 'captions.vtt', mimeType: 'text/vtt',
		buffer: Buffer.from('WEBVTT\n\n00:00.000 --> 00:01.000\nFile-backed caption\n'),
	});
	await expect(dialog.getByRole('status')).toHaveText('captions.vtt: No interchange losses.');
	await expect(dialog.getByRole('combobox', { name: 'Format', exact: true })).toHaveValue('webvtt');
	const downloadPromise = page.waitForEvent('download');
	await dialog.getByRole('button', { name: /Export selected track/u }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe('captions-1.vtt');
	expect(await readFile(await download.path(), 'utf8')).toBe(
		'WEBVTT\n\ncue-1\n00:00:00.000 --> 00:00:01.000\nFile-backed caption\n',
	);
	await expect(dialog.getByRole('status')).toHaveText('1 interchange loss recorded.');
	await closeFinishing(dialog);

	const exportDialog = await openExportDialog(page, editor, { label: 'Export video' });
	await chooseDropdown(page,
		exportDialog.getByRole('group', { name: 'Format', exact: true }), 'MP4 video');
	await expect(exportDialog.getByRole('group', { name: 'Burn in', exact: true })).toContainText('No captions');
	await expect(exportDialog.getByRole('group', { name: 'Deliver captions', exact: true })).toHaveCount(0);
	await exportDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(exportDialog).toBeHidden();

	const source = await storedMotionState(page, projectId);
	dialog = await openFinishing(page, editor, 'Analyze', /^Motion Tracking/u, 'Motion Tracking');
	const document = dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true });
	const finishing = JSON.parse(await document.inputValue());
	finishing.videoProcessorStacks = [trackingStack(source.sourceId)];
	await document.fill(JSON.stringify(finishing, null, 2));
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText('Finishing state updated.');
	await expect(dialog.getByRole('combobox', { name: 'Motion-analysis target', exact: true })).toBeVisible();
	await directTimecodeInput(dialog, 'Start frame').fill('0');
	await directTimecodeInput(dialog, 'End frame').fill('2');
	await dialog.getByRole('button', { name: 'Analyze motion', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText(
		'Motion analysis published and current.', { timeout: 60_000 },
	);
	await expect(dialog.getByRole('button', { name: 'Recompute motion', exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Recompute motion', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText(
		'Motion analysis published and current.', { timeout: 60_000 },
	);
	await closeFinishing(dialog);

	await expect.poll(() => storedMotionState(page, projectId)).toMatchObject({
		captionCueCount: 1,
		analysisCount: 1,
		analysisBodyStored: true,
	});
	expect(clientErrors).toEqual([]);
});

for (const source of ['video clip', 'still image']) test(`Framescaper burns the selected caption track over a ${source}`, async ({ page }) => {
	test.setTimeout(120_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	if (source === 'video clip') {
		await importFiles(editor, [{ name: 'caption-picture.webm', mimeType: 'video/webm',
			buffer: inflateSync(Buffer.from(CAPTION_VIDEO, 'base64')) }]);
	} else {
		const png = await page.evaluate(() => {
			const canvas = document.createElement('canvas');
			canvas.width = 320; canvas.height = 180;
			const context = canvas.getContext('2d');
			context.fillStyle = 'black'; context.fillRect(0, 0, canvas.width, canvas.height);
			return canvas.toDataURL('image/png').split(',')[1];
		});
		const chooser = page.waitForEvent('filechooser');
		await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
		await (await chooser).setFiles({ name: 'Backdrop.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
		await expect(editor.getByRole('group', { name: 'Image clip: Backdrop', exact: true })).toBeVisible();
	}
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const captions = await openFinishing(page, editor, 'Tracks', /^Caption Tracks/u, 'Caption Tracks');
	await captions.getByRole('textbox', { name: 'Track name', exact: true }).fill('English dialogue');
	await captions.locator('[data-framescaper-caption-file]').setInputFiles({
		name: 'dialogue.vtt', mimeType: 'text/vtt',
		buffer: Buffer.from('WEBVTT\n\n00:00.200 --> 00:00.900\nA visible caption\n'),
	});
	await expect(captions.getByRole('status')).toContainText('No interchange losses');
	await closeFinishing(captions);
	const dialog = await openExportDialog(page, editor, { label: 'Export video' });
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Format', exact: true }), 'WebM video');
	await dialog.getByRole('spinbutton', { name: 'Width', exact: true }).fill('320');
	await dialog.getByRole('spinbutton', { name: 'Height', exact: true }).fill('180');
	await dialog.getByRole('spinbutton', { name: 'Frame rate', exact: true }).fill('10');
	const burnIn = dialog.getByRole('group', { name: 'Burn in', exact: true });
	await expect(burnIn).toContainText('No captions');
	const link = dialog.locator('[data-export-download]');
	const exportVideo = dialog.getByRole('button', { name: 'Export', exact: true });
	await exportVideo.click();
	await expect(link).toBeVisible({ timeout: 60_000 });
	const uncaptioned = await readDownloadBytes(page, link);
	const previousDownload = await link.getAttribute('href');
	await chooseDropdown(page, burnIn, 'English dialogue');
	await exportVideo.click();
	await expect(link).toBeVisible({ timeout: 60_000 });
	await expect(link).not.toHaveAttribute('href', previousDownload);
	const captioned = await readDownloadBytes(page, link);
	const [before, during, after] = await page.evaluate(async ([plainBytes, captionBytes]) => {
		async function pictureBands(data) {
			const url = URL.createObjectURL(new Blob([Uint8Array.from(data)], { type: 'video/webm' }));
			const video = document.createElement('video');
			try {
				await new Promise((resolve, reject) => {
					video.onloadeddata = resolve;
					video.onerror = () => reject(video.error);
					video.src = url;
				});
				const canvas = document.createElement('canvas');
				canvas.width = video.videoWidth;
				canvas.height = video.videoHeight;
				const context = canvas.getContext('2d');
				async function pixelsAt(time) {
					await new Promise(resolve => { video.onseeked = resolve; video.currentTime = time; });
					context.drawImage(video, 0, 0);
					return context.getImageData(100, 140, 120, 22).data;
				}
				return [await pixelsAt(.1), await pixelsAt(.5), await pixelsAt(1.15)];
			} finally {
				video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
			}
		}
		const [plain, burned] = await Promise.all([pictureBands(plainBytes), pictureBands(captionBytes)]);
		return burned.map((pixels, index) => {
			let changed = 0;
			for (let offset = 0; offset < pixels.length; offset += 4) {
				const delta = Math.max(...[0, 1, 2].map(channel => Math.abs(pixels[offset + channel] - plain[index][offset + channel])));
				if (delta > 60) changed++;
			}
			return changed;
		});
	}, [[...uncaptioned], [...captioned]]);
	expect(during).toBeGreaterThan(Math.max(before, after) + 60);
});

async function openFinishing(page, editor, owner, itemName, title) {
	await editor.getByRole('menubar', { name: 'Application menu', exact: true })
		.getByRole('menuitem', { name: owner, exact: true }).click();
	const menu = page.getByRole('menu', { name: owner, exact: true });
	await expect(menu).toBeVisible();
	const item = menu.getByRole('menuitem', { name: itemName }).first();
	await expect(item).toBeEnabled();
	await item.focus();
	await page.keyboard.press('Enter');
	const dialog = page.getByRole('dialog', { name: title, exact: true });
	await expect(dialog).toBeVisible();
	return dialog;
}

function directTimecodeInput(scope, label) {
	return scope.getByRole('group', { name: label, exact: true })
		.locator('..')
		.locator('[data-timecode-direct-entry]');
}

async function closeFinishing(dialog) {
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(dialog).toBeHidden();
}

function trackingStack(sourceId) {
	return {
		schemaVersion: 1, id: 'stack-browser', sourceId,
		processors: [{
			schemaVersion: 1, id: 'tracking-browser', kind: 'tracking', enabled: true,
			maximumFeatures: 32, quality: 0.01, minimumDistance: 2,
			windowRadius: 2, pyramidLevels: 2,
		}],
	};
}

async function storedMotionState(page, projectId) {
	return page.evaluate(async ({ databaseName, id }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const project = await result(
				database.transaction('projects', 'readonly').objectStore('projects').get(id),
			);
			const source = project.sources.find(({ kind }) => kind === 'video');
			const reference = project.videoMotionAnalyses[0] ?? null;
			const body = reference ? await result(
				database.transaction('mediaAssets', 'readonly').objectStore('mediaAssets')
					.get(reference.storageKey),
			) : null;
			return {
				sourceId: source.id,
				captionCueCount: project.videoCaptionTracks[0]?.cues?.length ?? 0,
				analysisCount: project.videoMotionAnalyses.length,
				analysisBodyStored: Boolean(body),
			};
		} finally {
			database.close();
		}
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
}
