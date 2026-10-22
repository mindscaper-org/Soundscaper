/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { installMilestone7LocalAssistanceFixture } from './helpers/milestone-7-local-assistance.js';
import { createRound7SpeechPreviewBridge } from '../helpers/round7-speech-preview-bridge.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';

test('Text to Speech can add narration after the desktop opens another native project', async ({ page }) => {
	const runtime = createSoundscaperScapeNativeRuntime();
	const archive = await runtime.exportScapeProject(createSoundscaperProject({ id: 'speech-incoming', title: 'Incoming narration' }), {
		async getMediaAssetMetadata() { return null; }, async loadMediaAsset() { return null; },
		readSourceChunks() { return (async function* empty() {})(); },
	});
	const incoming = Buffer.from(await archive.blob.arrayBuffer()).toString('base64');
	await installMilestone7LocalAssistanceFixture(page);
	await page.addInitScript(createRound7SpeechPreviewBridge, true);
	await page.addInitScript(base64 => {
		const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
		const descriptor = { id: 'd'.repeat(40), readProfile: 'scape-range-v1', name: 'Incoming.sscape',
			mimeType: 'application/vnd.soundscaper.scape+zip', size: bytes.length,
			url: `soundscaper-app://bundle/_desktop/read/scape-range-v1/${'d'.repeat(40)}/Incoming.sscape` };
		const originalFetch = globalThis.fetch;
		globalThis.fetch = function (input, init) {
			if (String(input) !== descriptor.url) return originalFetch.call(this, input, init);
			const range = /^bytes=(\d+)-(\d+)$/u.exec(new Headers(init.headers).get('Range'));
			if (!range) throw new Error('A native archive read needs an exact byte range.');
			const start = Number(range[1]), end = Number(range[2]);
			const body = bytes.slice(start, end + 1);
			return Promise.resolve(new Response(body, { status: 206, headers: {
				'Content-Type': descriptor.mimeType, 'Content-Length': String(body.length),
				'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
			} }));
		};
		const bridge = globalThis.soundscaperDesktop.v1;
		Object.defineProperty(globalThis, 'soundscaperDesktop', { configurable: true, value: { v1: {
			...bridge,
			onOpenProject(listener) { globalThis.__nextSpeechOpen = () => listener(descriptor); return () => { globalThis.__nextSpeechOpen = null; }; },
			async releaseRead() {},
		} } });
	}, incoming);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Text to Speech');
	const speech = page.getByRole('dialog', { name: 'Text to Speech', exact: true });
	await expect(speech.getByRole('textbox', { name: 'Script', exact: true })).toBeEnabled();
	await expect.poll(() => page.evaluate(() => typeof globalThis.__nextSpeechOpen)).toBe('function');
	await page.evaluate(() => globalThis.__nextSpeechOpen());
	await expect(editor).toHaveAttribute('data-project-id', 'speech-incoming');
	await speech.getByRole('textbox', { name: 'Script', exact: true }).fill('Narration for the incoming project.');
	await speech.getByRole('button', { name: 'Generate preview', exact: true }).click();
	await expect(speech.locator('audio')).toBeVisible();
	await speech.getByRole('button', { name: 'Add as new track at playhead', exact: true }).click();
	await expect(editor.locator('[data-clip-id][role="group"]')).toHaveCount(1);
	await expect(speech.getByText('Speech added on a new track.', { exact: true })).toBeVisible();
});
