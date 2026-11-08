/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, clipByName, chooseCommandAction } from './audio-editor-test-helpers.js';
import { addClipGainPoint, persistedProject } from './helpers/complex-editing-workflows.js';

test('an envelope drag released in another tab retains its last intended gain as one edit', async ({ page, context, browserName }) => {
	test.skip(browserName !== 'chromium', 'Native cross-tab mouse release uses Chromium input dispatch.');
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'Outside envelope release.wav', duration: 1 });
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	const projectId = await editor.getAttribute('data-project-id');
	await addClipGainPoint(page, editor, clip, .5);
	const point = clip.locator('.envelope-point').first();
	const savedGain = async () => {
		const project = await persistedProject(page, projectId);
		const current = project.clips.length === 1 ? project.clips[0] : null;
		return current?.envelope.length ? Math.max(...current.envelope.map(item => item.value)) : null;
	};
	await expect.poll(async () => typeof (await savedGain())).toBe('number');
	const originalGain = await savedGain();
	const begin = async () => {
		const box = await point.boundingBox();
		if (!box) throw new Error('The clip-gain point must be visible.');
		const x = box.x + box.width / 2, y = box.y + box.height / 2;
		await page.mouse.move(x, y); await page.mouse.down();
		await page.mouse.move(x, y + 12, { steps: 3 });
		await expect.poll(async () => (await point.boundingBox()).y).toBeGreaterThan(box.y + 8);
		return { x, y };
	};
	await begin(); await page.mouse.up();
	await expect.poll(savedGain).toBeLessThan(originalGain);
	const intendedGain = await savedGain();
	await editor.getByRole('button', { name: 'Zoom in', exact: true }).click();
	await expect.poll(savedGain).toBe(intendedGain);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(savedGain).toBe(originalGain);
	await editor.getByRole('button', { name: 'Fit project', exact: true }).click();
	const other = await context.newPage();
	await other.goto('about:blank');
	const input = await context.newCDPSession(page), elsewhere = await context.newCDPSession(other);
	// Respect actual window focus in headed runs; buttons=0 also covers a missed blur in headless runs.
	await input.send('Emulation.setFocusEmulationEnabled', { enabled: false });
	await elsewhere.send('Emulation.setFocusEmulationEnabled', { enabled: false });
	await page.bringToFront();
	const pointer = await begin();
	try {
		await other.bringToFront();
		await elsewhere.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, x: 10, y: 10 });
		await page.bringToFront();
		await input.send('Input.dispatchMouseEvent', { type: 'mouseMoved', buttons: 0, x: pointer.x, y: pointer.y + 25 });
		await editor.getByRole('button', { name: 'Zoom in', exact: true }).click();
		await expect.poll(savedGain).toBe(intendedGain);
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect.poll(savedGain).toBe(originalGain);
		await chooseCommandAction(page, editor, 'Edit', 'Redo');
		await expect.poll(savedGain).toBe(intendedGain);
		await editor.getByRole('button', { name: 'Fit project', exact: true }).click();
		await begin(); await page.mouse.up();
		await expect.poll(savedGain).toBeLessThan(intendedGain);
	} finally {
		await page.mouse.up();
		await input.detach(); await elsewhere.detach(); await other.close();
	}
});
