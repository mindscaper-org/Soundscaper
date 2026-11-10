/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, halfMinuteTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';

test('a clip move keeps the old audio playing until replacement readiness and survives a selection change', async ({ page }) => {
	await page.addInitScript(() => {
		const playback = { connections: 0, disconnections: 0, waiting: 0, held: false };
		const pending = [];
		globalThis.__editingPlayback = playback;
		globalThis.__releaseEditingPlayback = () => {
			playback.held = false;
			for (const release of pending.splice(0)) release();
		};
		const resume = AudioContext.prototype.resume;
		AudioContext.prototype.resume = function (...args) {
			if (!playback.held) return Reflect.apply(resume, this, args);
			playback.waiting += 1;
			return new Promise(resolve => pending.push(resolve)).then(() => Reflect.apply(resume, this, args));
		};
		const connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (...args) {
			if (this.context instanceof AudioContext) playback.connections += 1;
			return Reflect.apply(connect, this, args);
		};
		const disconnect = AudioNode.prototype.disconnect;
		AudioNode.prototype.disconnect = function (...args) {
			if (this.context instanceof AudioContext) playback.disconnections += 1;
			return Reflect.apply(disconnect, this, args);
		};
	});
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [halfMinuteTone]);
	const clip = clipByName(editor, halfMinuteTone.name);
	await clip.press('Enter');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	const pause = editor.getByRole('button', { name: 'Pause', exact: true });
	await expect(pause).toBeVisible();
	await expect.poll(() => page.evaluate(() => globalThis.__editingPlayback.connections)).toBeGreaterThan(0);
	const before = await page.evaluate(() => {
		globalThis.__editingPlayback.held = true;
		return { ...globalThis.__editingPlayback };
	});
	const box = await clip.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(box.x + 28, box.y + 12);
	await page.mouse.down();
	await page.mouse.move(box.x + 88, box.y + 12, { steps: 5 });
	await expect.poll(async () => (await clip.boundingBox())?.x ?? 0).toBeGreaterThan(box.x + 20);
	expect(await page.evaluate(() => ({ connections: globalThis.__editingPlayback.connections, disconnections: globalThis.__editingPlayback.disconnections })))
		.toEqual({ connections: before.connections, disconnections: before.disconnections });
	await page.mouse.up();
	await expect.poll(() => page.evaluate(() => globalThis.__editingPlayback.waiting)).toBeGreaterThan(0);
	// Selection is independent of the audio edit while its new graph prepares.
	await clip.press('Enter');
	await expect(pause).toBeVisible();
	expect(await page.evaluate(() => ({ connections: globalThis.__editingPlayback.connections, disconnections: globalThis.__editingPlayback.disconnections })))
		.toEqual({ connections: before.connections, disconnections: before.disconnections });
	await page.evaluate(() => globalThis.__releaseEditingPlayback());
	await expect.poll(() => page.evaluate(() => globalThis.__editingPlayback.connections)).toBeGreaterThan(before.connections);
	await expect.poll(() => page.evaluate(() => globalThis.__editingPlayback.disconnections)).toBeGreaterThan(before.disconnections);
	await expect(pause).toBeVisible();
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect.poll(async () => (await clip.boundingBox())?.x ?? 0).toBeCloseTo(box.x, 0);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect.poll(async () => (await clip.boundingBox())?.x ?? 0).toBeGreaterThan(box.x + 20);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(pause).toBeVisible();
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	expect(errors).toEqual([]);
});
