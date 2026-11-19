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
import { nativeVideoAudioTailFixture } from '../helpers/native-video-audio-tail-fixture.ts';

test.describe('video container exporters', () => {
	registerAudioEditorHooks();
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
		try {
			const track = await input.getPrimaryAudioTrack();
			expect(await track.getCodec()).toBe('opus');
			const { description } = await track.getDecoderConfig();
			const header = Buffer.from(description);
			expect(header.toString('ascii', 0, 8)).toBe('OpusHead');
			const preSkip = header.readUInt16LE(10);
			const firstTime = await track.getFirstTimestamp();
			expect(Math.abs(firstTime + preSkip / 48_000)).toBeLessThanOrEqual(.0005 + Number.EPSILON);
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
		} finally { input.dispose(); }
		const tailPeak = await page.evaluate(async data => {
			const context = new OfflineAudioContext(1, 1, 48000);
			const audio = await context.decodeAudioData(Uint8Array.from(data).buffer);
			return audio.getChannelData(0).slice(95_760, 96_000).reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
		}, Array.from(bytes));
		expect(tailPeak).toBeGreaterThan(.05);
	});
	for (const [index, variant] of ['classic', 'fragmented', 'hybrid', 'quarter-turned'].entries()) {
		test(`${variant} VFR AVC with fractional frame timestamps delivers every picture cell`, async ({ page }) => {
			await disableNativeSavePicker(page);
			const editor = await bootEditor(page, '/framescaper/embed/en/');
			const turned = variant === 'quarter-turned';
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
					expect([await track.getCodedWidth(), await track.getCodedHeight()]).toEqual([48, 64]);
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
