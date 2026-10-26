/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, collectClientErrors } from './audio-editor-test-helpers.js';
import { installDesktopSpeedWarmupManifest } from './helpers/desktop-speed-warmup-fixture.js';
import { registerFileCapabilityIpc } from '../../desktop/main-file-capability-ipc.mjs';

test('Project Bin native chooser offers only audio and video source files', async ({ page }) => {
	const handlers = new Map();
	const panels = [];
	registerFileCapabilityIpc({
		channels: { chooseFiles: 'open', releaseRead: 'release', chooseSaveTarget: 'save', releaseSaveTarget: 'release-save',
			beginWrite: 'begin', writeChunk: 'chunk', patchFinalPrefix: 'prefix', finishWrite: 'finish', abortWrite: 'abort' },
		desktopSmokeProbe: { resolveOpenPaths: () => null, resolveSavePath: async () => null },
		dialog: { showOpenDialog: async (_window, options) => { panels.push(options); return { canceled: true, filePaths: [] }; },
			showSaveDialog: async () => ({ canceled: true }) },
		handle: (channel, listener) => { handlers.set(channel, listener); },
		opaqueId: String, ownerFor: () => 'owner', pendingOpenProjects: new Map(),
		readCapabilities: {}, saves: {}, saveTargets: {}, windowFor: () => null,
	});
	await page.exposeBinding('__binNativePanel', async (_source, request) => await handlers.get('open')({}, request));
	await installDesktopSpeedWarmupManifest(page);
	await page.addInitScript(() => Object.defineProperty(globalThis, 'soundscaperDesktop', { value: { v1: {
		chooseFiles: request => globalThis.__binNativePanel(request),
	} } }));
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	const bin = editor.locator('[data-workspace-panel="project-bin"]');
	if (!await bin.isVisible()) await chooseNestedCommandAction(page, editor, 'Window', ['Project bin']);
	const importButton = bin.locator('button').filter({ hasText: /^Add audio to Project bin$/u });
	await importButton.click();
	await expect.poll(() => panels.length).toBe(1);
	const offered = panels[0].filters.flatMap(filter => filter.extensions);
	for (const extension of ['wav', 'aifc', 'flac', 'mp4', 'm4v', 'webm']) expect(offered).toContain(extension);
	for (const extension of ['cue', 'txt', 'srt', 'vtt']) expect(offered).not.toContain(extension);
	await expect(importButton).toBeEnabled();
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	expect(errors).toEqual([]);
});
