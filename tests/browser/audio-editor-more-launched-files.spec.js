/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

test('separate OS launch events both import their files through the built workspace', async ({ page }) => {
	await page.addInitScript(() => Object.defineProperty(globalThis, 'launchQueue', {
		configurable: true, value: { setConsumer(consumer) { globalThis.__moreFileLaunch = consumer; } },
	}));
	const editor = await bootEditor(page, '/embed/en/');
	if (await editor.getByRole('heading', { name: 'Project bin', exact: true }).isVisible()) {
		await chooseCommandAction(page, editor, 'Window', 'Project bin');
		await expect(editor.getByRole('heading', { name: 'Project bin', exact: true })).toBeHidden();
	}
	await page.evaluate(base64 => {
		const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
		for (const name of ['first-launch.wav', 'second-launch.wav']) globalThis.__moreFileLaunch({
			files: [{ kind: 'file', getFile: () => Promise.resolve(new File([bytes], name, { type: 'audio/wav' })) }],
		});
	}, toneA.buffer.toString('base64'));
	await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 15_000 });
	await expect(clipByName(editor, 'first-launch.wav')).toBeVisible();
	await expect(clipByName(editor, 'second-launch.wav')).toBeVisible();
});

test('an unreadable OS-launched file shows its error in the workspace', async ({ page }) => {
	await page.addInitScript(() => Object.defineProperty(globalThis, 'launchQueue', {
		configurable: true, value: { setConsumer(consumer) { globalThis.__moreFileLaunch = consumer; } },
	}));
	await bootEditor(page, '/embed/en/');
	await page.evaluate(() => globalThis.__moreFileLaunch({ files: [{ kind: 'file',
		getFile: () => Promise.reject(new DOMException('Access to the launched recording was revoked.', 'NotAllowedError')),
	}] }));
	await expect(page.getByRole('alert')).toContainText('Access to the launched recording was revoked.');
});
