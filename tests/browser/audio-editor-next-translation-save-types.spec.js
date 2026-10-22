/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { registerFileCapabilityIpc } from '../../desktop/main-file-capability-ipc.mjs';
import { COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE } from '../../src/common/i18n/community-translations-copy.ts';

test('community translation exports offer their real file types in the native save panel', async ({ page }) => {
	const handlers = new Map();
	const panels = [];
	registerFileCapabilityIpc({
		channels: { chooseFiles: 'open', releaseRead: 'release', chooseSaveTarget: 'save', releaseSaveTarget: 'release-save',
			beginWrite: 'begin', writeChunk: 'chunk', patchFinalPrefix: 'prefix', finishWrite: 'finish', abortWrite: 'abort' },
		desktopSmokeProbe: { resolveOpenPaths: () => null, resolveSavePath: async () => null },
		dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
			showSaveDialog: async (_window, options) => { panels.push(options); return { canceled: true, filePath: '' }; } },
		handle: (channel, listener) => { handlers.set(channel, listener); },
		opaqueId: String, ownerFor: () => 'owner', pendingOpenProjects: new Map(),
		readCapabilities: {}, saves: {}, saveTargets: {}, windowFor: () => null,
	});
	await page.exposeBinding('__translationSavePanel', async (_source, request) => await handlers.get('save')({}, request));
	await page.addInitScript(() => Object.defineProperty(globalThis, 'soundscaperDesktop', { value: { v1: {
		chooseSaveTarget: request => globalThis.__translationSavePanel(request),
	} } }));
	const editor = await bootEditor(page, '/embed/en/');
	const copy = COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE.en;
	await chooseCommandAction(page, editor, 'Help', copy.menu);
	const surface = page.getByRole('dialog', { name: copy.title, exact: true });
	await expect(surface.getByRole('textbox', { name: copy.source, exact: true })).toBeVisible();
	for (const [label, extension] of [[copy.export, 'json'], [copy.po, 'zip']]) {
		const before = panels.length;
		await surface.getByRole('button', { name: label, exact: true }).click();
		await expect.poll(() => panels.length).toBe(before + 1);
		const panel = panels.at(-1);
		expect(panel.defaultPath).toBe(`soundscaper-translations-de.${extension}`);
		expect(panel.filters.flatMap(filter => filter.extensions)).toContain(extension);
		await expect(surface.getByRole('alert')).toHaveCount(0);
	}
});
