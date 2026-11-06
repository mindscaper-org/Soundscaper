/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { zeroCrossingDetectorProject } from '../helpers/zero-crossing-detector-project.ts';
import { findNearestAudioZeroCrossing } from '../../src/common/editor/zero-crossing.js';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

async function archive(position, mode) {
	const fixture = zeroCrossingDetectorProject(position, mode);
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		for (const [index, source] of fixture.sources.entries()) {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			const samples = fixture.samples[index];
			for (let offset = 0; offset < samples.length; offset += source.chunkFrames) {
				await writer.write([samples.slice(offset, offset + source.chunkFrames)]);
			}
			await writer.commit();
		}
		return { projectId: fixture.project.id, bytes: Buffer.from(await (await exportScapeProject(fixture.project, store)).blob.arrayBuffer()) };
	} finally { await store.close(); }
}

for (const [position, mode] of [
	['pre-fader', 'leaf'], ['post-fader', 'leaf'], ['post-fader', 'folder'], ['post-fader', 'vca'],
]) test(`At zero crossings retains the ${position} ${mode} detector signal`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const fixture = await archive(position, mode);
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Crossing detector.sscape', mimeType: 'application/zip', buffer: fixture.bytes });
	await expect(editor).toHaveAttribute('data-project-id', fixture.projectId);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only');
	await clipByName(editor, 'programme').locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Select', ['Region', 'Track start to end']);
	const reference = Float32Array.from(await exportSamples(page, editor));
	const edges = [10_007, 11_007];
	const expected = edges.map(frame => findNearestAudioZeroCrossing([reference], frame, { maximumDistance: 480 }));
	if (position === 'pre-fader') {
		// Editing a muted recording still examines its selected pre-fader signal.
		const mute = editor.locator('[data-track-row][data-track-id="programme"]').getByRole('button', { name: 'Mute', exact: true });
		await mute.click(); await expect(mute).toHaveAttribute('aria-pressed', 'true');
	}
	for (const [edge, value] of [['end', edges[1]], ['start', edges[0]]]) {
		const field = editor.getByRole('group', { name: `Selection ${edge}`, exact: true });
		await field.locator('.timecode__format-button').click();
		await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
		const digits = field.locator('.timecode-digit');
		await digits.first().click(); await page.keyboard.type(String(value).padStart(12, '0')); await page.keyboard.press('Enter');
		await expect.poll(async () => Number((await digits.allTextContents()).join(''))).toBe(value);
	}
	await chooseCommandAction(page, editor, 'Select', 'At zero crossings');
	await expect(editor.locator('[data-status]')).toHaveText(/zero crossings/iu);
	for (const [index, edge] of ['start', 'end'].entries()) {
		await expect.poll(async () => Math.abs(Number((await editor.getByRole('group', { name: `Selection ${edge}`, exact: true })
			.locator('.timecode-digit').allTextContents()).join('')) - expected[index])).toBeLessThanOrEqual(1);
	}
});
