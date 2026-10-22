/* SPDX-License-Identifier: AGPL-3.0-only */

import { Buffer } from 'node:buffer';
import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseDropdown,
	chooseFileAction,
	collectClientErrors,
	getMenuItem,
	openNestedCommandMenu,
	readDownloadBytes,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==',
	'base64',
);

registerAudioEditorHooks();

test.describe('Framescaper selected timeline images', () => {
	test('adds, undoes, redoes, reopens, and exports an image from Generate', async ({ browserName, page }) => {
		test.skip(
			browserName !== 'chromium',
			'The maintained browser MP4 publication route requires Chromium shared-memory FFmpeg.',
		);
		test.setTimeout(360_000);
		const clientErrors = collectClientErrors(page);
		await installProductionIsolationHeaders(
			page,
			resolveBrowserProductTestUrl('/framescaper/en/'),
		);
		let editor = await bootEditor(page, '/framescaper/en/');
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();

		const chooserPromise = page.waitForEvent('filechooser');
		const generate = await openNestedCommandMenu(page, editor, 'Generate', []);
		await getMenuItem(generate, EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']).click();
		const chooser = await chooserPromise;
		await chooser.setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: PNG });

		const imageClip = editor.locator('[data-clip-kind="image"]');
		await expect(imageClip).toHaveCount(1, { timeout: 30_000 });
		await expect(imageClip).toHaveAttribute('aria-label', 'Image clip: poster');
		await expect(imageClip.locator('[data-product-visual-thumbnail]')).toHaveCount(1);
		await expect.poll(() => storedImageState(page, projectId)).toMatchObject({
			schemaFamily: 'framescaper', schemaVersion: 1,
			sourceCount: 1,
			clipCount: 1,
			fileName: 'poster.png',
			width: 2,
			height: 2,
			timelineOwned: true,
			requiresTimelineImages: true,
		});
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');

		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(imageClip).toHaveCount(0);
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect(imageClip).toHaveCount(1);

		await page.reload();
		editor = page.locator('[data-audio-editor]');
		await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
		await expect(editor).toHaveAttribute('data-project-id', projectId);
		await expect(editor.locator('[data-clip-kind="image"]')).toHaveCount(1);
		await expect.poll(() => storedImageState(page, projectId)).toMatchObject({
			schemaFamily: 'framescaper', schemaVersion: 1, sourceCount: 1, clipCount: 1, timelineOwned: true,
		});

		await chooseFileAction(page, editor, 'Export video', { timeout: 120_000 });
		const dialog = page.getByRole('dialog', { name: 'Export video', exact: true });
		await chooseDropdown(page, dialog.getByRole('group', { name: 'Format', exact: true }), 'MP4 video');
		const canvasSize = dialog.locator('[data-export-field="canvasSize"] input');
		await canvasSize.nth(0).fill('64');
		await canvasSize.nth(1).fill('64');
		await dialog.locator('[data-export-field="canvasFrameRate"] input').fill('1');
		await dialog.locator('[data-export-action="start"]').getByRole('button').click();
		const download = dialog.locator('[data-export-download]');
		await waitForVideoPublication(page, editor, download, 120_000, clientErrors);
		await expect(download).toHaveAttribute('download', /\.mp4$/u);
		// Read through the download rather than fetching the blob: URL in the page:
		// the shipped policy's connect-src carries no blob:. The bytes go back into
		// the page because only a real <video> can prove the frame decodes.
		const encoded = Buffer.from(await readDownloadBytes(page, download)).toString('base64');
		const witness = await page.evaluate(async (base64) => {
			async function readNativeSourceCenter(video) {
				const frame = new VideoFrame(video);
				let payload, result, primary;
				let failed = false;
				try {
					const { primaries, transfer, matrix, fullRange } = frame.colorSpace;
					if (frame.format !== 'I420' || primaries !== 'bt709' || transfer !== 'bt709'
						|| matrix !== 'bt709' || fullRange !== false) throw new Error('Expected limited BT.709 I420.');
					const visible = frame.visibleRect;
					if (!visible || ![frame.codedWidth, frame.codedHeight].every((value) => (
						Number.isSafeInteger(value) && value > 0 && value <= 8192
					)) || ![visible.x, visible.y, visible.width, visible.height].every((value) => (
						Number.isSafeInteger(value) && value >= 0
					)) || visible.width !== 64 || visible.height !== 64
						|| frame.displayWidth !== 64 || frame.displayHeight !== 64
						|| visible.x + 64 > frame.codedWidth || visible.y + 64 > frame.codedHeight) {
						throw new Error('Unexpected decoded image aperture.');
					}
					const rect = { x: visible.x + 32, y: visible.y + 32, width: 2, height: 2 };
					if (rect.x % 2 || rect.y % 2 || frame.allocationSize({ rect }) !== 6) {
						throw new Error('Unexpected center I420 allocation.');
					}
					payload = new Uint8Array(6);
					const layout = await frame.copyTo(payload, { rect });
					if (layout.length !== 3 || payload.byteLength !== 6) throw new Error('Unexpected I420 layout.');
					const used = new Set();
					const planes = layout.map(({ offset, stride }, plane) => {
						const side = plane === 0 ? 2 : 1;
						if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(stride)
							|| stride < side) throw new Error('Invalid I420 plane bounds.');
						return Array.from({ length: side * side }, (_, index) => {
							const at = offset + Math.floor(index / side) * stride + index % side;
							if (at >= 6 || used.has(at)) throw new Error('Overlapping or unbounded I420 plane.');
							used.add(at);
							return payload[at];
						});
					});
					if (used.size !== 6) throw new Error('Incomplete I420 center copy.');
					const cb = (planes[1][0] - 128) / 224;
					const cr = (planes[2][0] - 128) / 224;
					// Independent limited BT.709 matrix, inverse OETF, then IEC sRGB encoding.
					const pixels = planes[0].map((sample) => {
						const y = (sample - 16) / 219;
						const red = y + 1.5748 * cr, blue = y + 1.8556 * cb;
						return [red, (y - 0.2126 * red - 0.0722 * blue) / 0.7152, blue].map((value) => {
							const encoded = Math.min(1, Math.max(0, value));
							const linear = encoded < 0.081 ? encoded / 4.5 : ((encoded + 0.099) / 1.099) ** (1 / 0.45);
							return 255 * (linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055);
						});
					});
					result = { format: frame.format, colorSpace: { primaries, transfer, matrix, fullRange }, pixels };
				} catch (error) { failed = true; primary = error; }
				const cleanup = [];
				try { payload?.fill(0); } catch (error) { cleanup.push(error); }
				try { frame.close(); } catch (error) { cleanup.push(error); }
				if (cleanup.length) throw new AggregateError(failed ? [primary, ...cleanup] : cleanup,
					'Native image center cleanup failed.', { cause: failed ? primary : cleanup[0] });
				if (failed) throw primary;
				return result;
			}
			const binary = atob(base64);
			const bytes = new Uint8Array(binary.length);
			for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
			const media = new Blob([bytes], { type: 'video/mp4' });
			const mediaUrl = URL.createObjectURL(media);
			let centerPixel, sourceCopy;
			let dimensions;
			try {
				const video = document.createElement('video');
				video.muted = true;
				video.preload = 'auto';
				await new Promise((resolve, reject) => {
					const timer = setTimeout(() => reject(new Error('Encoded image video did not decode.')), 15_000);
					video.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(); }, { once: true });
					video.addEventListener('error', () => {
						clearTimeout(timer);
						reject(video.error || new Error('Encoded image video failed to decode.'));
					}, { once: true });
					video.src = mediaUrl;
					video.load();
				});
				dimensions = [video.videoWidth, video.videoHeight];
				const canvas = document.createElement('canvas');
				canvas.width = 64;
				canvas.height = 64;
				const context = canvas.getContext('2d', { willReadFrequently: true });
				if (!context) throw new Error('Encoded image witness canvas is unavailable.');
				context.drawImage(video, 0, 0, canvas.width, canvas.height);
				centerPixel = [...context.getImageData(32, 32, 1, 1).data];
				sourceCopy = await readNativeSourceCenter(video);
			} finally {
				URL.revokeObjectURL(mediaUrl);
			}
			return {
				byteLength: bytes.byteLength,
				box: String.fromCharCode(...bytes.subarray(4, 8)),
				dimensions,
				centerPixel,
				sourceCopy,
			};
		}, encoded);
		expect(witness.byteLength).toBeGreaterThan(32);
		expect(witness.box).toBe('ftyp');
		expect(witness.dimensions).toEqual([64, 64]);
		expect(witness.sourceCopy.format).toBe('I420');
		expect(witness.sourceCopy.colorSpace).toEqual({
			primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false,
		});
		expect(witness.sourceCopy.pixels).toHaveLength(4);
		// H.264 is lossy; reverse the declared coding transfer before comparing source sRGB.
		// Browser video-to-canvas presentation need not invert that transfer mathematically.
		for (const pixel of witness.sourceCopy.pixels) {
			for (const [channel, expected] of [255, 32, 0].entries()) {
				expect(Math.abs(pixel[channel] - expected)).toBeLessThanOrEqual(12);
			}
		}
		expect(witness.centerPixel[3]).toBe(255);
		expect(clientErrors).toEqual([]);
	});
});

async function installProductionIsolationHeaders(page, documentUrl) {
	const routeMatcher = /^https?:\/\//u.test(documentUrl) ? documentUrl : `**${documentUrl}`;
	await page.route(routeMatcher, async (route) => {
		const response = await route.fetch();
		await route.fulfill({
			response,
			headers: {
				...response.headers(),
				'Cross-Origin-Opener-Policy': 'same-origin',
				'Cross-Origin-Embedder-Policy': 'credentialless',
			},
		});
	});
	await page.route(/\/assets\/[^/?]*worker-[^/?]+\.js(?:\?.*)?$/u, async (route) => {
		const response = await route.fetch();
		await route.fulfill({
			response,
			headers: {
				...response.headers(),
				'Cross-Origin-Embedder-Policy': 'credentialless',
				'Cross-Origin-Resource-Policy': 'same-origin',
			},
		});
	});
}

async function waitForVideoPublication(page, editor, download, timeout, clientErrors) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (await download.isVisible()) return;
		const status = await editor.locator('[data-status]').evaluate((element) => ({
			state: element.dataset.state ?? '', text: element.textContent ?? '',
		}));
		if (status.state === 'error') {
			throw new Error(`Video publication failed: ${status.text}; console=${JSON.stringify(clientErrors)}`);
		}
		await page.waitForTimeout(250);
	}
	throw new Error(`Video publication timed out: ${JSON.stringify({
		status: await editor.locator('[data-status]').evaluate((element) => ({
			state: element.dataset.state ?? '', text: element.textContent ?? '',
		})),
		clientErrors,
	})}`);
}

async function storedImageState(page, projectId) {
	return page.evaluate(({ databaseName, id }) => new Promise((resolve, reject) => {
		const open = indexedDB.open(databaseName);
		open.onerror = () => reject(open.error || new Error(`Could not open ${databaseName}.`));
		open.onsuccess = () => {
			const database = open.result;
			const request = database.transaction('projects').objectStore('projects').get(id);
			request.onerror = () => {
				database.close();
				reject(request.error || new Error(`Could not read ${id}.`));
			};
			request.onsuccess = () => {
				const project = request.result;
				const sources = project?.sources?.filter((source) => source.kind === 'image') ?? [];
				const clips = project?.clips?.filter((clip) => clip.kind === 'image') ?? [];
				const clipIds = new Set(project?.tracks?.flatMap((track) => track.clipIds ?? []) ?? []);
				const requirements = project?.featureRequirements?.requirements ?? [];
				database.close();
				resolve({
					schemaFamily: project?.schemaFamily ?? null,
					schemaVersion: project?.schemaVersion ?? null,
					sourceCount: sources.length,
					clipCount: clips.length,
					fileName: sources[0]?.original?.fileName ?? null,
					width: sources[0]?.canonical?.width ?? null,
					height: sources[0]?.canonical?.height ?? null,
					timelineOwned: clips.length === 1 && clipIds.has(clips[0].id),
					requiresTimelineImages: requirements.some(({ featureId }) => (
						featureId === 'org.soundscaper.capability.timeline-images-v1'
					)),
				});
			};
		};
	}), { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
}
