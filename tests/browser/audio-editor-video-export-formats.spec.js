/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { BufferSource, EncodedPacketSink, Input, WEBM } from 'mediabunny';
import {
	bootEditor, chooseDropdown, collectClientErrors, disableNativeSavePicker,
	importFiles, openExportDialog, readDownloadBytes, registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { videoRetimePreviewMedia } from './fixtures/video-retime-preview-media.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { sourceMonitorFragmentedMedia } from './fixtures/video-timing-probe-media.js';
import { videoSourceGeometryMedia } from './fixtures/video-source-geometry-media.js';
import { offsetVideoWebmFixture, zeroOriginVideoWebmFixture } from './fixtures/video-offset-webm.js';
import { hybridAv1VideoFixture } from './fixtures/video-hybrid-av1.js';
import { nativeVideoAudioTailFixture } from '../helpers/native-video-audio-tail-fixture.ts';

test.describe('video container exporters', () => {
	registerAudioEditorHooks();
	test('hybrid AV1 delivery includes the pictures after its initial sample table', async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'The maintained WebKit runtime cannot decode this AV1 profile.');
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await importFiles(editor, [hybridAv1VideoFixture()]);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		const dialog = await openExportDialog(page, editor, { label: 'Export video' });
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WebM video');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const link = dialog.locator('[data-export-download]');
		const error = page.locator('[data-editor-toast="workspace-error"], [data-editor-toast="workspace-status-error"]');
		await expect(link.or(error).first()).toBeVisible({ timeout: 25_000 });
		await expect(link).toBeVisible();
		const pictures = await readDeliveredPictureLabels(page, await readDownloadBytes(page, link));
		expect(pictures).toEqual([0, 0, 2, 3, 5, 5, 7, 9, 10, 10, 13, 14, 15, 15, 18, 19, 20, 22, 23, 24, 25, 25, 28]);
	});

	test('a forward VFR seek retry delivers the requested picture rather than its predecessor', async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await importFiles(editor, [zeroOriginVideoWebmFixture()]);
		const dialog = await openExportDialog(page, editor, { label: 'Export video' });
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WebM video');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const link = dialog.locator('[data-export-download]');
		await expect(link).toBeVisible({ timeout: 25_000 });
		const labels = await readDeliveredPictureLabels(page, await readDownloadBytes(page, link));
		expect(labels).toEqual([0, 0, 2, 3, 5, 5, 7, 9, 10, 10, 13, 14, 15, 15, 18, 19, 20, 22, 23, 24, 25, 25, 28]);
	});

	test('a video-only WebM with a positive packet origin exports its full picture clock', async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await importFiles(editor, [offsetVideoWebmFixture()]);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		const dialog = await openExportDialog(page, editor, { label: 'Export video' });
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WebM video');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const link = dialog.locator('[data-export-download]');
		const error = page.locator('[data-editor-toast="workspace-error"], [data-editor-toast="workspace-status-error"]');
		await expect(link.or(error).first()).toBeVisible({ timeout: 25_000 });
		await expect(link).toBeVisible();
		const input = new Input({ source: new BufferSource(await readDownloadBytes(page, link)), formats: [WEBM] });
		try {
			const track = await input.getPrimaryVideoTrack();
			expect(track).not.toBeNull();
			expect(await track.getFirstTimestamp()).toBe(0);
			expect(await track.computeDuration()).toBeCloseTo(1, 2);
			expect(await input.getAudioTracks()).toHaveLength(0);
		} finally { input.dispose(); }
	});

	test('WebM audio retains the authored Opus start and tail', async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await importFiles(editor, [{ name: 'Audio through the last picture.mp4', mimeType: 'video/mp4', buffer: nativeVideoAudioTailFixture(2) }]);
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		const dialog = await openExportDialog(page, editor, { label: 'Export video' });
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WebM video');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const link = dialog.locator('[data-export-download]');
		await expect(link).toBeVisible({ timeout: 25_000 });
		const bytes = await readDownloadBytes(page, link);
		const input = new Input({ source: new BufferSource(bytes), formats: [WEBM] });
		let decodedPacketFrames;
		try {
			const track = await input.getPrimaryAudioTrack();
			expect(await track.getCodec()).toBe('opus');
			const { description } = await track.getDecoderConfig();
			const header = Buffer.from(description);
			expect(header.toString('ascii', 0, 8)).toBe('OpusHead');
			const preSkip = header.readUInt16LE(10);
			const firstTime = await track.getFirstTimestamp();
			expect(firstTime).toBe(-preSkip / 48_000);
			let samples = -preSkip;
			let index = 0;
			for await (const packet of new EncodedPacketSink(track).packets()) {
				expect(packet.duration).toBeCloseTo(.02, 3);
				expect(packet.timestamp).toBeCloseTo(firstTime + index * .02, 3);
				samples += 960;
				index++;
			}
			expect(samples).toBeGreaterThanOrEqual(96_000);
			expect(samples).toBeLessThan(96_960);
			decodedPacketFrames = samples;
		} finally { input.dispose(); }
		const { decodedFrames, tailPeak } = await page.evaluate(async data => {
			const context = new OfflineAudioContext(1, 1, 48000);
			const audio = await context.decodeAudioData(Uint8Array.from(data).buffer);
			return { decodedFrames: audio.length,
				tailPeak: audio.getChannelData(0).slice(95_760, 96_000).reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0) };
		}, Array.from(bytes));
		expect(decodedFrames).toBe(decodedPacketFrames);
		expect(tailPeak).toBeGreaterThan(.05);
	});
	for (const [index, variant] of ['classic', 'fragmented', 'hybrid', 'quarter-turned', 'quarter-turned anamorphic'].entries()) {
		test(`${variant} VFR AVC with fractional frame timestamps delivers every picture cell`, async ({ page }) => {
			await disableNativeSavePicker(page);
			const editor = await bootEditor(page, '/framescaper/embed/en/');
			const turned = variant.startsWith('quarter-turned');
			const anamorphic = variant.endsWith('anamorphic');
			const file = sourceMonitorFragmentedMedia()[turned ? 0 : index];
			if (turned) {
				const buffer = Buffer.from(file.buffer);
				const header = buffer.indexOf('tkhd');
				expect(header).toBeGreaterThan(0);
				expect(buffer[header + 4]).toBe(0);
				// The fixture uses a version-zero track header with identity display
				// geometry. Change just its matrix, leaving coded packets untouched.
				const matrix = header + 44;
				const identity = [65536, 0, 0, 0, 65536, 0, 0, 0, 1 << 30];
				const rotation = [0, -65536, 0, 65536, 0, 0, 0, 0, 1 << 30];
				for (const [i, value] of rotation.entries()) {
					expect(buffer.readInt32BE(matrix + i * 4)).toBe(identity[i]);
					buffer.writeInt32BE(value, matrix + i * 4);
				}
				if (anamorphic) {
					// This pinned classic fixture has an eight-bit SPS aspect-ratio IDC at
					// avcC payload byte 16 and a matching container pixel aspect box.
					const avcC = buffer.indexOf('avcC');
					const pasp = buffer.indexOf('pasp');
					expect(buffer.readUInt32BE(avcC - 4)).toBe(51);
					expect(buffer[avcC + 20]).toBe(1);
					expect(buffer.readUInt32BE(pasp + 4)).toBe(1);
					expect(buffer.readUInt32BE(pasp + 8)).toBe(1);
					buffer[avcC + 20] = 16;
					buffer.writeUInt32BE(2, pasp + 4);
				}
				file.buffer = buffer;
			}
			await importFiles(editor, [file]);
			await expect(editor).toHaveAttribute('data-clip-count', '2');
			const dialog = await openExportDialog(page, editor, { label: 'Export video' });
			await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WebM video');
			await dialog.getByRole('button', { name: 'Export', exact: true }).click();
			const link = dialog.locator('[data-export-download]');
			const error = page.locator('[data-editor-toast="workspace-error"], [data-editor-toast="workspace-status-error"]');
			await expect(link.or(error).first()).toBeVisible({ timeout: 25_000 });
			await expect(link).toBeVisible();
			const input = new Input({ source: new BufferSource(await readDownloadBytes(page, link)), formats: [WEBM] });
			try {
				const track = await input.getPrimaryVideoTrack();
				expect(track).not.toBeNull();
				if (turned) {
					expect([await track.getCodedWidth(), await track.getCodedHeight()]).toEqual([48, anamorphic ? 128 : 64]);
				}
				let pictures = 0;
				for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) {
					expect(packet.timestamp).toBeCloseTo(pictures * 29 / 660, 3);
					pictures++;
				}
				expect(pictures).toBe(22);
				expect(await input.getAudioTracks()).toHaveLength(1);
			} finally { input.dispose(); }
		});
	}

	test('a rotated anamorphic clip presents its authored aspect in Programme and WebM', async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		const source = videoSourceGeometryMedia.find(({ id }) => id === 'geometry-rotated-anamorphic-mp4-v1');
		await importFiles(editor, [source.file]);
		const canvas = editor.locator('[data-video-preview-canvas]');
		await expect(canvas).toHaveAttribute('data-renderer-state', 'ready');
		await expect.poll(async () => {
			const screenshot = await canvas.screenshot({ scale: 'css' });
			return page.evaluate(async ({ png, display }) => {
				const image = new Image();
				image.src = `data:image/png;base64,${png}`;
				await image.decode();
				const line = new OffscreenCanvas(image.width, 1).getContext('2d');
				line.drawImage(image, 0, -Math.floor(image.height / 4));
				const { data } = line.getImageData(0, 0, image.width, 1);
				let visible = 0;
				for (let offset = 0; offset < data.length; offset += 4) {
					if (data[offset] + data[offset + 1] + data[offset + 2] > 90) visible++;
				}
				return Math.abs(visible - image.height * display.width / display.height);
			}, { png: screenshot.toString('base64'), display: source.display });
		}).toBeLessThanOrEqual(3);
		const dialog = await openExportDialog(page, editor, { label: 'Export video' });
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WebM video');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const link = dialog.locator('[data-export-download]');
		await expect(link).toBeVisible({ timeout: 25_000 });
		const input = new Input({ source: new BufferSource(await readDownloadBytes(page, link)), formats: [WEBM] });
		try {
			const track = await input.getPrimaryVideoTrack();
			expect({ width: await track.getCodedWidth(), height: await track.getCodedHeight() }).toEqual(source.display);
		} finally { input.dispose(); }
	});

	for (const [label, extension, mimeType, source, dimensions] of [
		['MP4 video', 'mp4', 'video/mp4', videoRetimePreviewMedia.file,
			{ width: videoRetimePreviewMedia.width, height: videoRetimePreviewMedia.height }],
		['WebM video', 'webm', 'video/webm', videoRetimePreviewMedia.file,
			{ width: videoRetimePreviewMedia.width, height: videoRetimePreviewMedia.height }],
		['MP4 video', 'mp4', 'video/mp4', createDeterministicSilentVideoFixture('recorded.webm'),
			{ width: 96, height: 54 }],
		['WebM video', 'webm', 'video/webm', createDeterministicSilentVideoFixture('recorded.webm'),
			{ width: 96, height: 54 }],
	]) {
		test(`${label} downloads a playable container from ${source.name}`, async ({ page }) => {
			test.setTimeout(90000);
			await disableNativeSavePicker(page);
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, '/framescaper/embed/en/');
			const sourceDuration = await page.evaluate(async ({ data, type }) => {
				const url = URL.createObjectURL(new Blob([Uint8Array.from(data)], { type }));
				const video = document.createElement('video');
				try {
					await new Promise((resolve, reject) => {
						video.onloadedmetadata = resolve;
						video.onerror = () => reject(new Error('The source container is not playable.'));
						video.src = url;
					});
					return video.duration;
				} finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
			}, { data: Array.from(source.buffer), type: source.mimeType });
			await importFiles(editor, [source]);
			await expect(editor).toHaveAttribute('data-clip-count', '1');
			await expect(editor.locator('[data-status]')).not.toContainText('could not be decoded');
			const dialog = await openExportDialog(page, editor, { label: 'Export video' });
			await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), label);
			await dialog.getByRole('button', { name: 'Export', exact: true }).click();
			const link = dialog.locator('[data-export-download]');
			await expect(link.filter({ visible: true }).or(page.locator('[data-editor-toast="workspace-error"], [data-editor-toast="workspace-status-error"]'))).toBeVisible({ timeout: 60000 });
			await expect(link).toBeVisible();
			await expect(link).toHaveAttribute('download', new RegExp(`\\.${extension}$`));
			const bytes = await readDownloadBytes(page, link);
			const metadata = await page.evaluate(async ({ data, type }) => {
				const url = URL.createObjectURL(new Blob([Uint8Array.from(data)], { type }));
				const video = document.createElement('video');
				try {
					await new Promise((resolve, reject) => {
						video.onloadeddata = resolve;
						video.onerror = () => reject(new Error('The exported container is not playable.'));
						video.src = url;
					});
					return { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
				} finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
			}, { data: Array.from(bytes), type: mimeType });
			// Delivery rounds the final partial frame up to its frame-rate boundary.
			expect(metadata.duration).toBeGreaterThanOrEqual(sourceDuration - 0.01);
			expect(metadata.duration).toBeLessThan(sourceDuration + 0.1);
			expect(metadata).toMatchObject(dimensions);
			expect(errors).toEqual([]);
		});
	}
});

async function readDeliveredPictureLabels(page, bytes) {
	const input = new Input({ source: new BufferSource(bytes), formats: [WEBM] });
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error('The delivered picture track is missing.');
		const interiorTimes = [];
		for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) {
			interiorTimes.push(packet.timestamp + packet.duration / 4);
		}
		return await page.evaluate(async ({ data, interiorTimes }) => {
			const video = document.createElement('video');
			video.muted = true;
			video.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0';
			document.body.append(video);
			const source = URL.createObjectURL(new Blob([Uint8Array.from(data)], { type: 'video/webm' }));
			const context = new OffscreenCanvas(64, 48).getContext('2d');
			const wait = event => new Promise((resolve, reject) => {
				video.addEventListener(event, resolve, { once: true });
				video.onerror = () => reject(new Error('The delivered WebM could not be decoded.'));
			});
			try {
				const loaded = wait('loadeddata');
				video.src = source;
				await loaded;
				const labels = [];
				for (const seconds of interiorTimes) {
					const seeked = wait('seeked');
					video.currentTime = seconds;
					await seeked;
					context.drawImage(video, 0, 0);
					const cells = [12, 36].flatMap(y => [8, 24, 40, 56].map(x => context.getImageData(x, y, 1, 1).data[0]));
					const label = cells.slice(2, 7).reduce((value, pixel, bit) => value | (pixel > 128 ? 1 << bit : 0), 0);
					labels.push(cells[0] < 35 && cells[1] > 215 ? label : null);
				}
				return labels;
			} finally {
				video.removeAttribute('src');
				video.load();
				video.remove();
				URL.revokeObjectURL(source);
			}
		}, { data: Array.from(bytes), interiorTimes });
	} finally { input.dispose(); }
}
