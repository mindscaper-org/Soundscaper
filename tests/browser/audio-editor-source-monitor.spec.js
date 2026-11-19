import { expect } from '@playwright/test';
import { test } from './audio-editor-test-fixtures.js';

import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { highRateIntraVideoFile } from './fixtures/video-paused-preview-media.js';
import { videoSourceGeometryMedia } from './fixtures/video-source-geometry-media.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import {
	DURABLE_MEDIA_STORAGE_REQUIRED,
	hasDurableMediaStorageCapability,
} from './helpers/durable-media-storage-capability.js';

const DATABASE_NAME = FRAMESCAPER_DATABASE_NAME;
const CFR = videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1');
const MARK_IN = 4;
const MARK_OUT_FRAME = 13;
const MARKED_FRAMES = MARK_OUT_FRAME + 1 - MARK_IN;
const SOURCE_FRAMES = CFR.presentationTicks.length;

test.describe('3B-3b source monitor qualification', () => {
	test('the Source Monitor displays the authored width of a rotated anamorphic picture', async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'The rotated AVC fixture follows its Chromium and Firefox import qualification.');
		const editor = await openFramescaper(page);
		test.skip(!await page.evaluate(hasDurableMediaStorageCapability), DURABLE_MEDIA_STORAGE_REQUIRED);
		const fixture = videoSourceGeometryMedia.find(({ id }) => id === 'geometry-rotated-anamorphic-mp4-v1');
		await editor.locator('[data-project-bin-input]').setInputFiles(fixture.file);
		await editor.locator('[data-bin-action="source-monitor"]').first().click();
		const picture = editor.locator('[data-source-monitor-video]').locator('..');
		await expect.poll(async () => {
			const screenshot = await picture.screenshot({ scale: 'css' });
			return page.evaluate(async ({ png, width, height }) => {
				const image = new Image();
				image.src = `data:image/png;base64,${png}`;
				await image.decode();
				const canvas = document.createElement('canvas');
				canvas.width = image.width;
				const context = canvas.getContext('2d');
				context.drawImage(image, 0, -Math.floor(image.height / 4));
				const { data } = context.getImageData(0, 0, image.width, 1);
				let occupied = 0;
				for (let pixel = 2; pixel < image.width - 2; pixel++) {
					const rgb = pixel * 4;
					if (data[rgb] + data[rgb + 1] + data[rgb + 2] > 80) occupied++;
				}
				return Math.abs(occupied - image.height * width / height);
			}, { png: screenshot.toString('base64'), ...fixture.display });
		}).toBeLessThanOrEqual(2);
	});

	test('stepping displays each high-speed source picture at its exact ordinal', async ({ page, browserName }) => {
		test.skip(browserName !== 'chromium', 'The high-speed AVC fixture exercises Chromium frame selection.');
		const editor = await openFramescaper(page);
		test.skip(!await page.evaluate(hasDurableMediaStorageCapability), DURABLE_MEDIA_STORAGE_REQUIRED);
		await editor.locator('[data-project-bin-input]').setInputFiles(highRateIntraVideoFile);
		await page.locator('[data-bin-action="source-monitor"]').first().click();
		const monitor = editor.locator('[data-source-monitor]');
		await expect(monitor.locator('[data-source-monitor-scrub]')).toHaveAttribute('max', '3');
		const video = monitor.locator('video');
		const picture = () => video.evaluate(element => {
			const canvas = document.createElement('canvas');
			canvas.width = canvas.height = 1;
			const context = canvas.getContext('2d');
			context.drawImage(element, 0, 0, 1, 1);
			return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(channel => Number(channel > 128));
		});
		await expect.poll(picture).toEqual([1, 0, 0]);
		for (const [frame, color] of [[1, [0, 1, 0]], [2, [0, 0, 1]], [3, [1, 1, 0]]]) {
			await monitor.getByRole('button', { name: 'Next frame', exact: true }).click();
			await expect(monitor).toHaveAttribute('data-source-monitor-frame', String(frame));
			await expect.poll(picture).toEqual(color);
		}
		await monitor.getByRole('button', { name: 'Previous frame', exact: true }).click();
		await expect(monitor).toHaveAttribute('data-source-monitor-frame', '2');
		await expect.poll(picture).toEqual([0, 0, 1]);

		await scrubTo(page, 1);
		await scrubTo(page, 3);
		await scrubTo(page, 1);
		await monitor.locator('[data-source-monitor-action="mark-in"]').click();
		await expect(monitor).toHaveAttribute('data-source-monitor-mark-in', '1');
		await expect.poll(picture).toEqual([0, 1, 0]);
	});

	test('a marked range edits, matches back, and replaces in place', async ({ page }) => {
		test.setTimeout(180_000);

		const editor = await openFramescaper(page);
		test.skip(
			!await page.evaluate(hasDurableMediaStorageCapability),
			DURABLE_MEDIA_STORAGE_REQUIRED,
		);
		await editor.locator('[data-project-bin-input]').setInputFiles([CFR.file]);
		await expect.poll(() => binVideoClips(page), { timeout: 60_000 }).not.toHaveLength(0);
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		await addToTimeline(editor);
		await expect.poll(() => timelineVideoClips(page), { timeout: 30_000 }).not.toHaveLength(0);

		// The source opens on its own frame grid, at its head, with nothing marked.
		await page.locator('[data-bin-action="source-monitor"]').first().click();
		const monitor = page.locator('[data-source-monitor]');
		await expect(monitor).toBeVisible();
		await expect(monitor).toHaveAttribute('data-source-monitor-frame', '0');
		await expect(monitor).toHaveAttribute('data-source-monitor-mark-in', '');

		await scrubTo(page, MARK_IN);
		await page.locator('[data-source-monitor-action="mark-in"]').click();
		await scrubTo(page, MARK_OUT_FRAME);
		await page.locator('[data-source-monitor-action="mark-out"]').click();
		// The out is exclusive, so marking a frame keeps it.
		await expect(monitor).toHaveAttribute('data-source-monitor-mark-in', String(MARK_IN));
		await expect(monitor).toHaveAttribute('data-source-monitor-mark-out', String(MARK_OUT_FRAME + 1));

		const rate = await sequenceRate(page);
		const markedExtent = Math.round(
			MARKED_FRAMES * rate.num * CFR.nominalRate.den / (rate.den * CFR.nominalRate.num),
		);
		const beforeOverwrite = await timelineVideoClips(page);
		expect(beforeOverwrite.length).toBe(1);

		// The marked range is shorter than what is on air, so the overwrite lands
		// in front of a surviving tail rather than replacing the whole clip.
		await page.locator('[data-bin-action="overwrite"]').first().click();
		await expect.poll(() => timelineVideoClips(page), { timeout: 30_000 }).toHaveLength(2);
		const overwritten = await timelineVideoClips(page);
		expect(overwritten[0].sequenceStartFrame).toBe(0);
		expect(overwritten[0].sequenceFrameCount).toBe(markedExtent);
		expect(overwritten[0].sourceInFrame).toBe(MARK_IN);
		expect(overwritten[0].sourceFrameCount).toBe(MARKED_FRAMES);
		expect(overwritten[1].sequenceStartFrame).toBe(markedExtent);

		// Match-frame from the playhead, which is still at the head of the
		// programme, names the frame that landed there and leaves the monitor
		// holding exactly the material that clip uses.
		await scrubTo(page, 0);
		await page.locator('[data-source-monitor-action="match-frame"]').click();
		await expect(monitor).toHaveAttribute('data-source-monitor-frame', String(MARK_IN));
		await expect(monitor).toHaveAttribute('data-source-monitor-mark-in', String(MARK_IN));
		await expect(monitor).toHaveAttribute('data-source-monitor-mark-out', String(MARK_IN + MARKED_FRAMES));

		// Replace keeps the placement and the extent and changes only the media.
		await scrubTo(page, MARK_IN + 2);
		await page.locator('[data-source-monitor-action="replace"]').click();
		await expect.poll(async () => (await timelineVideoClips(page))[0]?.sourceInFrame, { timeout: 30_000 })
			.toBe(MARK_IN + 2);
		const replaced = await timelineVideoClips(page);
		expect(replaced).toHaveLength(2);
		expect(replaced[0].sequenceStartFrame).toBe(0);
		expect(replaced[0].sequenceFrameCount).toBe(markedExtent);
		expect(replaced[0].sourceFrameCount).toBe(MARKED_FRAMES);
		expect(replaced[1].sequenceStartFrame).toBe(markedExtent);
	});

	test('clearing the marks puts the whole source back in the edit', async ({
		page,
	}) => {
		test.setTimeout(180_000);

		const editor = await openFramescaper(page);
		test.skip(
			!await page.evaluate(hasDurableMediaStorageCapability),
			DURABLE_MEDIA_STORAGE_REQUIRED,
		);
		await editor.locator('[data-project-bin-input]').setInputFiles([CFR.file]);
		await expect.poll(() => binVideoClips(page), { timeout: 60_000 }).not.toHaveLength(0);
		await addToTimeline(editor);
		await expect.poll(() => timelineVideoClips(page), { timeout: 30_000 }).not.toHaveLength(0);
		await page.locator('[data-bin-action="source-monitor"]').first().click();
		const monitor = page.locator('[data-source-monitor]');
		await expect(monitor).toBeVisible();

		await scrubTo(page, MARK_IN);
		await page.locator('[data-source-monitor-action="mark-in"]').click();
		await scrubTo(page, MARK_OUT_FRAME);
		await page.locator('[data-source-monitor-action="mark-out"]').click();
		await page.locator('[data-bin-action="overwrite"]').first().click();
		await expect.poll(async () => (await timelineVideoClips(page))[0]?.sourceFrameCount, { timeout: 30_000 })
			.toBe(MARKED_FRAMES);

		// Marking changes what an edit uses, not how it resolves: with the marks
		// cleared the media's own boundaries fill in again, and the same action
		// places the whole source over everything the marked one left behind.
		await page.locator('[data-source-monitor-action="clear-marks"]').click();
		await expect(monitor).toHaveAttribute('data-source-monitor-mark-in', '');
		await expect(monitor).toHaveAttribute('data-source-monitor-mark-out', '');
		await page.locator('[data-bin-action="overwrite"]').first().click();
		await expect.poll(async () => (await timelineVideoClips(page))[0]?.sourceFrameCount, { timeout: 30_000 })
			.toBe(SOURCE_FRAMES);
		const whole = await timelineVideoClips(page);
		expect(whole).toHaveLength(1);
		expect(whole[0].sourceInFrame).toBe(0);
	});
});

async function addToTimeline(editor) {
	const name = CFR.file.name.replace(/\.[^.]+$/u, '');
	await editor.getByRole('button', { name: `Add to timeline: ${name}`, exact: true }).click();
}

async function openFramescaper(page) {
	await page.goto(resolveBrowserProductTestUrl('/framescaper/en/'));
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible();
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
	const decline = page.getByRole('button', { name: 'Decline', exact: true });
	if (await decline.isVisible()) await decline.click();
	return editor;
}

/** Put the monitor's playhead on one source frame through its own control. */
async function scrubTo(page, frame) {
	const scrub = page.locator('[data-source-monitor-scrub]');
	await scrub.fill(String(frame));
	await expect(page.locator('[data-source-monitor]'))
		.toHaveAttribute('data-source-monitor-frame', String(frame));
}

async function timelineVideoClips(page) {
	return (await persistedClips(page, 'timeline'))
		.map(({ id, sequenceStartFrame, sequenceFrameCount, sourceInFrame, sourceFrameCount }) => ({
			id, sequenceStartFrame, sequenceFrameCount, sourceInFrame, sourceFrameCount,
		}))
		.sort((left, right) => left.sequenceStartFrame - right.sequenceStartFrame);
}

async function binVideoClips(page) {
	return persistedClips(page, 'bin');
}

/** The rate of the sequence the edit landed in. */
async function sequenceRate(page) {
	return page.evaluate(async (databaseName) => {
		const request = (input) => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		const database = await request(indexedDB.open(databaseName));
		try {
			const projects = await request(
				database.transaction(['projects'], 'readonly').objectStore('projects').getAll(),
			);
			return projects.flatMap((project) => project.sequences || [])[0]?.rate ?? null;
		} finally {
			database.close();
		}
	}, DATABASE_NAME);
}

async function persistedClips(page, scope) {
	return page.evaluate(async ({ databaseName, where }) => {
		const request = (input) => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		const database = await request(indexedDB.open(databaseName));
		try {
			const projects = await request(
				database.transaction(['projects'], 'readonly').objectStore('projects').getAll(),
			);
			return projects.flatMap((project) => (
				where === 'bin' ? project.projectBin?.clips || [] : project.clips || []
			).filter((clip) => clip.kind === 'video'));
		} finally {
			database.close();
		}
	}, { databaseName: DATABASE_NAME, where: scope });
}
