/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, halfMinuteTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, clipNameAccessiblePattern, collectClientErrors, importFiles, waitForEditor } from './audio-editor-test-helpers.js';

test('track and clip renaming keeps the running audio graph and remains usable without restarting', async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__renamePlaybackGraph = { connections: 0, disconnections: 0 };
		const connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (...args) {
			if (this.context instanceof AudioContext) globalThis.__renamePlaybackGraph.connections += 1;
			return Reflect.apply(connect, this, args);
		};
		const disconnect = AudioNode.prototype.disconnect;
		AudioNode.prototype.disconnect = function (...args) {
			if (this.context instanceof AudioContext) globalThis.__renamePlaybackGraph.disconnections += 1;
			return Reflect.apply(disconnect, this, args);
		};
	});
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [halfMinuteTone]);
	let clip = clipByName(editor, halfMinuteTone.name);
	const track = editor.locator('[data-track-row]').filter({ has: page.getByRole('group', { name: clipNameAccessiblePattern(halfMinuteTone.name) }) });
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	const pause = editor.getByRole('button', { name: 'Pause', exact: true });
	await expect(pause).toBeVisible();
	await expect.poll(() => page.evaluate(() => globalThis.__renamePlaybackGraph.connections)).toBeGreaterThan(0);
	const graph = await page.evaluate(() => globalThis.__renamePlaybackGraph);
	for (const name of ['Dialogue', 'Final dialogue']) {
		const trackName = track.getByRole('button', { name: /^Rename track:/u });
		await trackName.dblclick();
		const input = track.getByRole('textbox', { name: /^Track name:/u });
		await expect(input).toBeFocused();
		await input.fill(name);
		await input.press('Enter');
		await expect(trackName).toHaveText(name);
		await expect(pause).toBeVisible();
	}
	for (const name of ['Opening line', 'Final opening']) {
		await clip.locator('.clip-header__name').dblclick();
		const input = clip.getByRole('textbox', { name: 'Clip name', exact: true });
		await expect(input).toBeFocused();
		await input.fill(name);
		await input.press('Enter');
		clip = clipByName(editor, name);
		await expect(clip).toBeVisible();
		await expect(pause).toBeVisible();
	}
	expect(await page.evaluate(() => globalThis.__renamePlaybackGraph)).toEqual(graph);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	await expect.poll(() => page.evaluate(() => globalThis.__renamePlaybackGraph.disconnections)).toBeGreaterThan(graph.disconnections);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(pause).toBeVisible();
	await expect.poll(() => page.evaluate(() => globalThis.__renamePlaybackGraph.connections)).toBeGreaterThan(graph.connections);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(clipByName(editor, 'Opening line')).toBeVisible();
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(clipByName(editor, 'Final opening')).toBeVisible();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload();
	const reopened = await waitForEditor(page);
	await expect(reopened.getByRole('button', { name: 'Rename track: Final dialogue', exact: true })).toBeVisible();
	await expect(clipByName(reopened, 'Final opening')).toBeVisible();
	expect(errors).toEqual([]);
});
