/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';

async function incomingProject() {
	const runtime = createFramescaperScapeNativeRuntime(PROFILE);
	const archive = await runtime.exportScapeProject(createFramescaperProject(PROFILE, { id: 'caption-incoming', title: 'Incoming captions' }), {
		async getMediaAssetMetadata() { return null; }, async loadMediaAsset() { return null; },
		readSourceChunks() { return (async function* empty() {})(); },
	});
	expect(archive.blob).toBeInstanceOf(Blob);
	return Buffer.from(await archive.blob.arrayBuffer()).toString('base64');
}

test('an OS-opened Framescaper project can import captions while an outgoing read remains delayed', async ({ page }) => {
	const project = await incomingProject();
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, 'launchQueue', { configurable: true,
			value: { setConsumer(consumer) { globalThis.__nextCaptionLaunch = consumer; } } });
		const nativeRead = File.prototype.arrayBuffer;
		File.prototype.arrayBuffer = function () {
			if (this.name !== 'delayed.srt') return nativeRead.call(this);
			globalThis.__nextCaptionReadPending = true;
			return new Promise(resolve => { globalThis.__nextCaptionReadRelease = () => { void nativeRead.call(this).then(resolve); }; });
		};
	});
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
	const dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
	const body = Buffer.from('1\n00:00:00,000 --> 00:00:01,000\nIncoming caption\n');
	await dialog.locator('[data-framescaper-caption-file]').setInputFiles({ name: 'delayed.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(body.toString().replace('Incoming caption', 'Outgoing stale caption')) });
	await expect.poll(() => page.evaluate(() => globalThis.__nextCaptionReadPending)).toBe(true);
	await page.evaluate(base64 => {
		const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
		globalThis.__nextCaptionLaunch({ files: [{ kind: 'file', getFile: () => Promise.resolve(new File([bytes], 'incoming.fscape', { type: 'application/x-scape-project' })) }] });
	}, project);
	await expect(editor).toHaveAttribute('data-project-id', 'caption-incoming');
	await expect(dialog.getByRole('button', { name: 'Choose sidecar file', exact: true })).toBeEnabled();
	await dialog.locator('[data-framescaper-caption-file]').setInputFiles({ name: 'incoming.srt', mimeType: 'application/x-subrip', buffer: body });
	await expect(dialog.getByRole('button', { name: 'Export selected track', exact: true })).toBeEnabled();
	await page.evaluate(() => globalThis.__nextCaptionReadRelease());
	await expect(dialog.getByRole('textbox', { name: 'Sidecar text', exact: true })).toHaveValue(body.toString());
});
