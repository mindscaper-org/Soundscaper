/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { videoOnlyFragmentedAvcFixture } from './fixtures/video-only-fragmented-avc.js';
import { BlobSource, EncodedPacketSink, Input, WEBM } from 'mediabunny';

async function sourcePictureTime(file, ordinal) {
	const input = new Input({ source: new BlobSource(new Blob([file.buffer])), formats: [WEBM] });
	try {
		const track = await input.getPrimaryVideoTrack();
		let index = 0;
		for await (const packet of new EncodedPacketSink(track).packets()) {
			if (index++ === ordinal) return packet.timestamp;
		}
		throw new Error('The ordinary video fixture has no requested source picture.');
	} finally { input.dispose(); }
}

for (const freeze of [false, true]) test(`ordinary Project bin video preview preserves ${freeze ? 'an authored freeze' : 'continuous playback'}`, async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const fixture = createDeterministicSilentVideoFixture('bin-retime.webm');
	const frozenTime = freeze ? await sourcePictureTime(fixture, 2) : null;
	await importFiles(editor, [fixture]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	await clip.focus(); await clip.press('Enter');
	if (freeze) {
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Video retime']);
		const dialog = page.getByRole('dialog', { name: 'Video retime', exact: true });
		await dialog.getByRole('textbox', { name: 'Source frame', exact: true }).fill('2');
		await dialog.getByRole('button', { name: 'Apply freeze', exact: true }).click();
		await expect(dialog.getByRole('status').last()).toHaveText('Video retime updated.');
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	}
	await clip.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	const card = editor.getByRole('listitem', { name: 'Project bin: bin-retime', exact: true });
	await expect(card).toBeVisible();
	await card.getByRole('button', { name: /^Play:/u }).click();
	const media = card.locator('video');
	await expect(media).toBeVisible();
	await expect.poll(() => media.evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
	if (freeze) {
		expect(await media.evaluate(video => video.paused)).toBe(true);
		await expect.poll(() => media.evaluate(video => video.currentTime)).toBeCloseTo(frozenTime, 5);
		await card.getByRole('button', { name: /^Pause:/u }).click();
		await expect(card.getByRole('button', { name: /^Play:/u })).toBeVisible();
		await expect.poll(() => media.evaluate(video => video.currentTime)).toBeCloseTo(frozenTime, 5);
		await card.getByRole('button', { name: /^Play:/u }).click();
		await expect(card.getByRole('button', { name: /^Pause:/u })).toBeVisible();
		await expect(card.getByRole('button', { name: /^Play:/u })).toBeVisible({ timeout: 5_000 });
		await expect(media).toHaveCount(0);
		await card.getByRole('button', { name: /^Play:/u }).click();
		await expect(card.getByRole('button', { name: /^Pause:/u })).toBeVisible();
		expect(await media.evaluate(video => video.paused)).toBe(true);
		await expect.poll(() => media.evaluate(video => video.currentTime)).toBeCloseTo(frozenTime, 5);
	} else {
		await expect.poll(() => media.evaluate(video => video.currentTime)).toBeGreaterThan(0.03);
		expect(await media.evaluate(video => video.paused)).toBe(false);
	}
	await card.getByRole('button', { name: /^More file actions:/u }).click();
	await page.getByRole('menuitem', { name: 'Remove from project', exact: true }).click();
	await page.getByRole('alertdialog', { name: 'Remove from project', exact: true })
		.getByRole('button', { name: 'Remove from project', exact: true }).click();
	await expect(card).toHaveCount(0);
});

test('Project Bin plays the authored picture clock of reordered fragmented AVC', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'The comparison uses Chromium’s presented-picture callback clock.');
	const editor = await bootEditor(page, '/framescaper/en/');
	const fixture = videoOnlyFragmentedAvcFixture();
	await editor.locator('[data-project-bin-input]').setInputFiles(fixture);
	const card = editor.getByRole('listitem', { name: `Project bin: ${fixture.name.replace(/\.mp4$/u, '')}`, exact: true });
	await card.getByRole('button', { name: /^Play:/u }).click();
	const frames = await card.locator('video').evaluate(video => new Promise(resolve => {
		const samples = [];
		const canvas = document.createElement('canvas');
		canvas.width = 64;
		canvas.height = 48;
		const context = canvas.getContext('2d', { willReadFrequently: true });
		let request = 0;
		const finish = () => {
			clearTimeout(timeout);
			video.cancelVideoFrameCallback(request);
			resolve(samples);
		};
		const observe = (_now, { mediaTime }) => {
			context.drawImage(video, 0, 0, canvas.width, canvas.height);
			const cells = [.25, .75].flatMap(y => [.125, .375, .625, .875].map(x =>
				context.getImageData(canvas.width * x, canvas.height * y, 1, 1).data[0]));
			const label = cells[0] <= 35 && cells[1] >= 215
				? cells.slice(2, 7).reduce((value, pixel, bit) => value | (pixel > 127 ? 1 << bit : 0), 0) : null;
			samples.push({ mediaTime, label });
			if (video.currentTime > .82 || video.ended) finish();
			else request = video.requestVideoFrameCallback(observe);
		};
		const timeout = setTimeout(finish, 2_000);
		request = video.requestVideoFrameCallback(observe);
	}));
	const interior = frames.filter(({ mediaTime }) => mediaTime >= .13 && mediaTime < .81);
	// Each physical label encodes the picture’s presentation time in 1/30 s units.
	const labels = [0, 2, 3, 4, 5, 7, 8, 9, 10, 12, 13, 14, 15, 17, 18, 19, 20, 22, 23, 24, 25, 28];
	expect(interior.length).toBeGreaterThan(7);
	expect(interior.map(({ label }) => label)).toEqual(interior.map(({ mediaTime }) =>
		labels.findLast(label => label / 30 <= mediaTime + .000002)));
});
