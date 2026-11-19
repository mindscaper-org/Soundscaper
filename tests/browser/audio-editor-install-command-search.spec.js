/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';

test('command search enables the install action when the browser offers installation', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const search = editor.getByRole('combobox', { name: 'Search commands and media', exact: true });
	await search.fill('Install Soundscaper');
	const install = editor.getByRole('option', { name: /^Install Soundscaper/u });
	await expect(install).toHaveAttribute('aria-disabled', 'true');
	await offerInstallation(page);
	await expect(install).not.toHaveAttribute('aria-disabled', 'true');
	await install.click();
	await expect(page.locator('body')).toHaveAttribute('data-install-prompt-opened', 'true');
});

test('the editor keeps the installation offer that arrives during startup', async ({ page }) => {
	const requested = Promise.withResolvers();
	const ready = Promise.withResolvers();
	await page.route('**/assets/SoundscaperAudioEditorBootstrap-*.js', async route => {
		requested.resolve();
		await ready.promise;
		await route.continue();
	});
	const booting = bootEditor(page, '/embed/en/', { showProjectBin: false });
	try {
		await requested.promise;
		await offerInstallation(page);
	} finally {
		ready.resolve();
	}
	const editor = await booting;
	await editor.getByRole('menuitem', { name: 'Help', exact: true }).click();
	const install = page.getByRole('menuitem', { name: /^Install Soundscaper/u });
	await expect(install).toBeEnabled();
	await install.click();
	await expect(page.locator('body')).toHaveAttribute('data-install-prompt-opened', 'true');
});

async function offerInstallation(page) {
	await page.evaluate(() => {
		const offer = new Event('beforeinstallprompt', { cancelable: true });
		Object.assign(offer, {
			prompt: () => { document.body.dataset.installPromptOpened = 'true'; },
			userChoice: Promise.resolve({ outcome: 'accepted' }),
		});
		window.dispatchEvent(offer);
	});
}
