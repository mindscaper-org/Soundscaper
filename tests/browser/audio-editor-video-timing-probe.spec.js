import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { test } from './audio-editor-test-fixtures.js';

import { validateVideoTimingAssetBytes } from '../../src/common/editor/video-timing-asset.ts';
import {
	endEditedMp4TimingProbeMedia, fragmentedMp4TimingProbeMedia, sourceMonitorFragmentedMedia, videoTimingProbeMedia,
} from './fixtures/video-timing-probe-media.js';
import { bootEditor, chooseFileAction, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { openFramescaperSourcePropertiesFromBin } from './helpers/framescaper-source-properties.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';
import {
	FRAMESCAPER_DATABASE_NAME,
	FRAMESCAPER_OPFS_DIRECTORY_NAME,
} from './helpers/editor-databases.js';
import {
	DURABLE_MEDIA_STORAGE_REQUIRED,
	hasDurableMediaStorageCapability,
} from './helpers/durable-media-storage-capability.js';

const DATABASE_NAME = FRAMESCAPER_DATABASE_NAME;
const TIMING_MEDIA = [...videoTimingProbeMedia, fragmentedMp4TimingProbeMedia, endEditedMp4TimingProbeMedia];

test.describe('WP-0.3 browser timing-probe qualification', () => {
	test('imports and persists exact CFR, WebM, fragmented MP4 and trimmed MP4 timings', async ({
		page,
	}, testInfo) => {
		test.setTimeout(60_000);

		await page.goto(resolveBrowserProductTestUrl('/framescaper/en/'));
		const editor = page.locator('[data-audio-editor]');
		await expect(editor).toBeVisible();
		await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
		const decline = page.getByRole('button', { name: 'Decline', exact: true });
		if (await decline.isVisible()) await decline.click();
		test.skip(
			!await page.evaluate(hasDurableMediaStorageCapability),
			DURABLE_MEDIA_STORAGE_REQUIRED,
		);

		const localFiles = await Promise.all(TIMING_MEDIA.map(async ({ file }) => {
			const path = testInfo.outputPath(file.name);
			await writeFile(path, file.buffer);
			return path;
		}));
		await editor.locator('[data-project-bin-input]').setInputFiles(localFiles);
		await expect.poll(async () => (await persistedTimingEvidence(page)).length, {
			timeout: 30_000,
		}).toBe(TIMING_MEDIA.length);
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');

		const evidence = await persistedTimingEvidence(page);
		for (const fixture of TIMING_MEDIA) {
			const actual = evidence.find(({ source }) => source.name === fixture.file.name);
			expect(actual, `${fixture.id} must publish a persisted source and timing body`).toBeTruthy();
			const { source, timingBytes } = actual;
			expect(source.contentSha256).toBe(fixture.sourceSha256);
			expect(source.frameRate).toEqual(fixture.nominalRate);
			expect(source.sourceFrameCount).toBe(fixture.presentationTicks.length);
			expect(source.timingDecision).toEqual({
				mode: 'exact',
				rate: fixture.nominalRate,
				backend: 'container',
			});
			expect(source.timingAsset).toMatchObject({
				sha256: fixture.timingSha256,
				sourceSha256: fixture.sourceSha256,
				frameCount: fixture.presentationTicks.length,
				timescale: fixture.timescale,
				finalFrameDurationTicks: fixture.finalFrameDurationTicks.toString(),
			});

			// The same probe run reports what the source is, not only when its
			// frames are; an unreported characteristic stays null rather than
			// arriving as a plausible default.
			expect(source.characteristics.backend).toBe('container');
			expect(source.characteristics.codedWidth).toBe(fixture.coded.width);
			expect(source.characteristics.codedHeight).toBe(fixture.coded.height);
			expect(source.characteristics.fieldOrder).toBeNull();
			const isWebm = fixture.file.mimeType === 'video/webm';
			expect(source.characteristics.hasAlpha).toBe(isWebm);
			expect(source.characteristics.videoCodec).toBe(isWebm ? 'vp8' : 'h264');
			expect(source.videoCodec).toBe(source.characteristics.videoCodec);
			// These files report no audio tracks.
			expect(source.characteristics.audioStreams).toEqual([]);
			expect(source.characteristics.extractedAudioStreamIndex).toBeNull();
			expect(source.characteristics.startTimecode).toBeNull();

			const timing = validateVideoTimingAssetBytes(
				source.timingAsset,
				Uint8Array.from(timingBytes),
			);
			expect(timing.presentationTicks).toEqual(fixture.presentationTicks);
			expect(timing.finalFrameDurationTicks).toBe(fixture.finalFrameDurationTicks);
			const deltas = timing.presentationTicks.slice(1).map((tick, index) => (
				tick - timing.presentationTicks[index]
			));
			if (fixture.kind === 'cfr') {
				expect(deltas.every((delta) => delta === fixture.finalFrameDurationTicks)).toBe(true);
			} else {
				expect(new Set(deltas.map(String)).size).toBeGreaterThan(1);
				expect(deltas.some((delta) => delta !== fixture.finalFrameDurationTicks)).toBe(true);
			}
		}

		// The probed truth is legible in the product, not only in storage: place
		// the imported picture on the timeline and read it under the playhead.
		await editor.getByRole('button', { name: /^Add to timeline: /u }).first().click();
		await expect(editor.locator('[data-source-timecode]')).not.toHaveAttribute('data-source-timecode', '');
		await expect(editor.locator('[data-source-timecode]')).toHaveAttribute('data-source-origin', 'unknown');
		const firstName = videoTimingProbeMedia[0].file.name.replace(/\.[^.]+$/u, '');
		const properties = await openFramescaperSourcePropertiesFromBin(page, editor, firstName);
		await expect(properties).toBeVisible();
		await expect(properties.locator('[data-source-property="Coded size"] dd')).toHaveText('192 × 144');
		await expect(properties.locator('[data-source-property="Field order"] dd'))
			.toHaveAttribute('data-reported', 'false');
		await expect(properties.locator('[data-source-property="Source start timecode"] dd'))
			.toHaveAttribute('data-reported', 'false');
		await expect(properties.locator('[data-source-property="Video codec"] dd'))
			.toHaveAttribute('data-reported', 'true');
	});
});

test('Programme seeks render the authored pictures beyond the first hybrid MP4 run', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const [classic, , hybrid] = sourceMonitorFragmentedMedia();
	const preview = editor.locator('[data-video-preview]');
	const picture = preview.locator('[data-video-preview-canvas]');
	const snapshots = [];
	for (const file of [classic, hybrid]) {
		await importFiles(editor, [file]);
		await expect(preview).toHaveAttribute('data-video-preview-renderer', 'ready');
		for (const ordinal of [3, 12, 20, 25]) {
			await seekFramescaperTimecode(page, editor, `00:00:00:${String(ordinal).padStart(2, '0')}`);
			await expect(preview).toHaveAttribute('data-video-preview-evaluated-timeline-sample', String(ordinal * 1600));
			const digest = async () => createHash('sha256').update(await picture.screenshot()).digest('hex');
			if (file === classic) snapshots.push(await digest());
			else await expect.poll(digest).toBe(snapshots.shift());
		}
		if (file === classic) {
			expect(new Set(snapshots).size).toBe(4);
			const projectId = await editor.getAttribute('data-project-id');
			await chooseFileAction(page, editor, 'New');
			await expect(editor).not.toHaveAttribute('data-project-id', projectId);
			await waitForProjectActivation(editor);
		}
	}
});

async function persistedTimingEvidence(page) {
	return page.evaluate(async ({ databaseName, opfsDirectoryName, sourceNames }) => {
		const request = (input) => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		const readMediaAssetBytes = async (record, mediaChunks) => {
			if (record.storage === 'opfs') {
				const root = await navigator.storage.getDirectory();
				const directory = await root.getDirectoryHandle(opfsDirectoryName);
				const handle = await directory.getFileHandle(record.path);
				return new Uint8Array(await (await handle.getFile()).arrayBuffer());
			}
			if (record.blob instanceof Blob) return new Uint8Array(await record.blob.arrayBuffer());
			const chunks = mediaChunks
				.filter(({ mediaChunkToken }) => mediaChunkToken === record.mediaChunkToken)
				.sort((left, right) => left.index - right.index);
			const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.payload.size, 0));
			let offset = 0;
			for (const chunk of chunks) {
				const payload = new Uint8Array(await chunk.payload.arrayBuffer());
				bytes.set(payload, offset);
				offset += payload.byteLength;
			}
			return bytes;
		};
		const database = await request(indexedDB.open(databaseName));
		try {
			const transaction = database.transaction(['projects', 'mediaAssets', 'mediaAssetChunks'], 'readonly');
			const [projects, mediaAssets, mediaChunks] = await Promise.all([
				request(transaction.objectStore('projects').getAll()),
				request(transaction.objectStore('mediaAssets').getAll()),
				request(transaction.objectStore('mediaAssetChunks').getAll()),
			]);
			const project = projects.find((candidate) => sourceNames.every((name) => (
				candidate.sources?.some((source) => source.name === name)
			)));
			if (!project) return [];
			const evidence = [];
			for (const source of project.sources.filter(({ name }) => sourceNames.includes(name))) {
				const record = mediaAssets.find(({ sourceId }) => sourceId === source.timingAsset?.storageKey);
				if (!record) continue;
				const timingBytes = await readMediaAssetBytes(record, mediaChunks);
				evidence.push({ source, timingBytes: [...timingBytes] });
			}
			return evidence;
		} finally {
			database.close();
		}
	}, {
		databaseName: DATABASE_NAME,
		opfsDirectoryName: FRAMESCAPER_OPFS_DIRECTORY_NAME,
		sourceNames: TIMING_MEDIA.map(({ file }) => file.name),
	});
}
