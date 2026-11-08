/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';

const bytes = Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000903c648360803c0000ff2f00', 'hex');
for (const cancel of [false, true]) test(`mixed File Import retains its Cancel decision with MIDI and labels, cancel=${cancel}`, async ({ page }) => {
	await page.addInitScript(() => {
		const held = new WeakSet(), slice = File.prototype.slice;
		File.prototype.slice = function (...args) {
			const result = slice.apply(this, args);
			if (this.name === 'Cancel take.wav') held.add(result);
			return result;
		};
		let released = false;
		const waiting = [];
		globalThis.__mixedMidiRelease = () => { released = true; for (const resume of waiting) resume(); };
		const read = Blob.prototype.arrayBuffer;
		Blob.prototype.arrayBuffer = async function () {
			if (held.has(this) && !released) {
				globalThis.__mixedMidiHeld = true;
				await new Promise(resolve => { waiting.push(resolve); });
			}
			return read.call(this);
		};
		const fileRead = File.prototype.arrayBuffer;
		globalThis.__mixedMidiReads = 0;
		File.prototype.arrayBuffer = function () {
			if (this.name === 'Later.mid') globalThis.__mixedMidiReads++;
			return fileRead.call(this);
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	// Prime the ordinary MIDI modules so cancellation assertions observe the
	// resumed import microtasks rather than unrelated first-use network loading.
	await importFiles(editor, [{ name: 'Warm.mid', mimeType: 'audio/midi', buffer: bytes }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const previous = await editor.getAttribute('data-project-id');
	await editor.getByRole('button', { name: 'New project', exact: true }).click();
	await expect(editor).not.toHaveAttribute('data-project-id', previous);
	await waitForProjectActivation(editor);
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	await editor.locator('[data-import-input]').setInputFiles([
		{ ...toneA, name: 'Cancel take.wav' }, { name: 'Later.mid', mimeType: 'audio/midi', buffer: bytes },
		{ name: 'Later.txt', mimeType: 'text/plain', buffer: Buffer.from('0\t1\tLater label\n') },
	]);
	await expect.poll(() => page.evaluate(() => globalThis.__mixedMidiHeld)).toBe(true);
	const progress = editor.locator('[data-editor-task-progress="import"]');
	if (cancel) await progress.getByRole('button', { name: 'Cancel', exact: true }).click();
	await page.evaluate(async () => {
		globalThis.__mixedMidiRelease();
		await new Promise(resolve => { requestAnimationFrame(() => requestAnimationFrame(resolve)); });
	});
	await expect(progress).toHaveCount(0);
	if (cancel) {
		expect(await page.evaluate(() => globalThis.__mixedMidiReads)).toBe(0);
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	} else {
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await expect(editor.locator('[data-label-track]')).toHaveCount(1);
		expect(await page.evaluate(() => globalThis.__mixedMidiReads)).toBe(1);
	}
});
