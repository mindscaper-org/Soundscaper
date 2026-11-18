/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

for (const restart of ['same card', 'another card']) {
	test(`an interrupted Project Bin video play cannot stop playback on ${restart}`, async ({ page }) => {
		await page.addInitScript(() => {
			const nativePlay = HTMLMediaElement.prototype.play;
			globalThis.__binVideoPlays = [];
			HTMLMediaElement.prototype.play = function () {
				if (!this.closest('[data-project-bin-video]')) return nativePlay.call(this);
				return new Promise((resolve, reject) => { globalThis.__binVideoPlays.push({ resolve, reject }); });
			};
		});
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		const names = restart === 'same card' ? ['First'] : ['First', 'Second'];
		await importFiles(editor, names.map(name => createDeterministicSilentVideoFixture(`${name}.webm`)));
		for (const name of names) {
			const clip = editor.getByRole('group', { name: `Video clip: ${name}`, exact: true });
			await clip.click({ button: 'right' });
			await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
		}
		const first = editor.getByRole('listitem', { name: 'Project bin: First', exact: true });
		const current = editor.getByRole('listitem', { name: `Project bin: ${names.at(-1)}`, exact: true });
		await first.getByRole('button', { name: /^Play:/u }).click();
		const calls = () => page.evaluate(() => globalThis.__binVideoPlays.length);
		await expect.poll(calls).toBe(1);
		if (restart === 'same card') await first.getByRole('button', { name: /^Pause:/u }).click();
		await current.getByRole('button', { name: /^Play:/u }).click();
		await expect.poll(calls).toBe(2);
		await page.evaluate(async () => {
			globalThis.__binVideoPlays[1].resolve();
			globalThis.__binVideoPlays[0].reject(new DOMException('Playback was interrupted by pause.', 'AbortError'));
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		});
		await expect(current.getByRole('button', { name: /^Pause:/u })).toBeVisible();
		await expect(current.locator('video')).toBeVisible();
	});
}
