/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

test('the imported camera audio stretch handle retimes its linked picture in one Undo step', async ({ page }) => {
	test.setTimeout(60_000);
	const editor = await bootEditor(page, '/framescaper/en/');
	await importFiles(editor, [createDeterministicAvFixture('Linked camera.webm')]);
	const projectId = await editor.getAttribute('data-project-id');
	const read = () => page.evaluate(async ({ databaseName, id }) => {
		const database = await new Promise((resolve, reject) => {
			const request = indexedDB.open(databaseName);
			request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
		});
		try {
			return await new Promise((resolve, reject) => {
				const request = database.transaction(['projects'], 'readonly').objectStore('projects').get(id);
				request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
			});
		} finally { database.close(); }
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
	await expect.poll(async () => (await read())?.clips?.length).toBe(2);
	const before = await read();
	const audio = before.clips.find(clip => clip.kind === 'audio');
	const video = before.clips.find(clip => clip.kind === 'video');
	expect(audio.avLinkId).toBe(video.avLinkId);
	const sequence = before.sequences.find(item => item.id === video.sequenceId);
	const group = editor.locator(`[data-clip-id="${audio.id}"][role="group"]`);
	await group.focus(); await group.press('Enter'); await group.hover();
	const handle = group.locator('.clip-display__handle--stretch-right');
	const bounds = await group.boundingBox(), hit = await handle.boundingBox();
	expect(bounds).not.toBeNull(); expect(hit).not.toBeNull();
	const count = video.sequenceFrameCount + 6;
	const targetX = bounds.x + bounds.width * count / video.sequenceFrameCount;
	await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
	await page.mouse.down();
	await page.mouse.move(targetX, hit.y + hit.height / 2, { steps: 4 });
	await page.mouse.up();
	const durations = async () => {
		const project = await read();
		return [project.clips.find(clip => clip.id === video.id).sequenceFrameCount,
			project.clips.find(clip => clip.id === audio.id).durationFrames];
	};
	const sampleAt = frame => Math.round(frame * before.sampleRate * sequence.rate.den / sequence.rate.num);
	const after = [count, sampleAt(video.sequenceStartFrame + count) - sampleAt(video.sequenceStartFrame)];
	await expect.poll(durations).toEqual(after);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(durations).toEqual([video.sequenceFrameCount, audio.durationFrames]);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(durations).toEqual(after);
});
