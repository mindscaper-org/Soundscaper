/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseFileAction, importFiles, openExportDialog, trackNameText,
} from './audio-editor-test-helpers.js';
import { installLinkedAudioBridge } from './helpers/linked-audio-relink-fixture.js';
import { createSesFixture } from '../helpers/ses-fixture.ts';
import { encodeWav } from '../../src/common/editor/wav.js';

function sessionFixture() {
	return createSesFixture({
		tracks: [{ name: 'Legacy voice', gain: 0.5 }],
		files: [{ path: 'C:\\recordings\\Voice.wav' }],
		clips: [{ startFrame: 480, lengthFrames: 960, sourceInFrame: 240 }],
	});
}

async function installSesBridge(page) {
	const left = new Float32Array(2400).fill(0.125), right = new Float32Array(2400).fill(0.375);
	left.fill(0.75, 0, 240); right.fill(0.875, 0, 240);
	const media = { name: 'Voice.wav', mimeType: 'audio/wav',
		buffer: Buffer.from(encodeWav([left, right], { sampleRate: 48000, float: true })) };
	await installLinkedAudioBridge(page, { original: media, changed: media });
	const valid = sessionFixture(), malformed = valid.slice();
	malformed[0] = 0;
	await page.addInitScript(({ valid, malformed, wave }) => {
		const state = { nextSession: 0, releasedSessions: [], releasedReads: [], mediaRequests: [] };
		const bodies = [valid, malformed, wave].map(bytes => Uint8Array.from(bytes));
		const descriptors = bodies.map((body, index) => {
			const id = String(index + 1).repeat(64), name = index === 2 ? 'Voice.wav' : index ? 'Broken.ses' : 'Legacy.ses';
			const readProfile = index === 2 ? 'linked-audio-range-v1' : 'selected-range-v1';
			return { id, name, readProfile, size: body.length, lastModified: 0,
				mimeType: index === 2 ? 'audio/wav' : 'application/octet-stream',
				url: `soundscaper-app://bundle/_desktop/read/${readProfile}/${id}/${name}` };
		});
		const nativeFetch = globalThis.fetch.bind(globalThis);
		globalThis.fetch = async (input, init) => {
			const url = input instanceof Request ? input.url : String(input);
			const index = descriptors.findIndex(descriptor => descriptor.url === url);
			if (index < 0) return nativeFetch(input, init);
			const header = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get('Range');
			const interval = /^bytes=(\d+)-(\d+)$/u.exec(header ?? '');
			if (!interval) return new Response(null, { status: 416 });
			const start = Number(interval[1]), end = Number(interval[2]), bytes = bodies[index].slice(start, end + 1);
			return new Response(bytes, { status: 206, headers: {
				'Accept-Ranges': 'bytes', 'Content-Length': String(bytes.length),
				'Content-Range': `bytes ${start}-${end}/${bodies[index].length}`, 'Content-Type': descriptors[index].mimeType,
			} });
		};
		Object.defineProperty(globalThis, '__legacySesFixture', { configurable: true, value: state });
		Object.defineProperty(globalThis, 'soundscaperDesktop', { configurable: true, value: { v1: {
			...globalThis.soundscaperDesktop.v1,
			chooseFiles: async () => [descriptors[state.nextSession]],
			resolveSesxMedia: async request => {
				state.mediaRequests.push(request);
				if (request.relativePath !== 'Voice.wav') throw new Error('SES media lookup must use the granted basename.');
				return { status: 'found', descriptor: descriptors[2] };
			},
			chooseSesxMediaFolder: async () => ({ status: 'cancelled' }),
			releaseSesxSession: async id => { state.releasedSessions.push(id); return true; },
			releaseRead: async id => { state.releasedReads.push(id); return true; },
		} } });
	}, { valid: [...valid], malformed: [...malformed], wave: [...media.buffer] });
}

test('desktop File Open imports SES timing, source trim and gain, and exposes its limitations', async ({ page }) => {
	test.setTimeout(60_000);
	await installSesBridge(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseFileAction(page, editor, 'Open');
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 20_000 });
	await expect(trackNameText(editor).first()).toHaveText('Legacy voice');
	await expect(editor.locator('[data-status]')).toContainText('Delivery Report');
	await chooseFileAction(page, editor, 'Delivery Report');
	const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
	await expect(report).toContainText('SES');
	await expect(report).toContainText(/partial|legacy/iu);
	await expect(report).toContainText(/effects/iu);
	await expect(report).toContainText(/envelopes/iu);
	await report.getByRole('button', { name: 'Close', exact: true }).last().click();
	const dialog = await openExportDialog(page, editor);
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.exports.length)).toBe(1);
	const rendered = await page.evaluate(async () => {
		const bytes = globalThis.__projectBinLinkedAudioFixture.exports[0];
		const buffer = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(Uint8Array.from(bytes).buffer);
		return { channels: buffer.numberOfChannels, frames: buffer.length,
			before: buffer.getChannelData(0)[479], left: buffer.getChannelData(0)[580], right: buffer.getChannelData(1)[580] };
	});
	expect(rendered).toMatchObject({ channels: 2, frames: 1440 });
	expect(rendered.before).toBeCloseTo(0, 4);
	expect(rendered.left).toBeCloseTo(0.0625, 4);
	expect(rendered.right).toBeCloseTo(0.1875, 4);
	const grants = await page.evaluate(() => globalThis.__legacySesFixture);
	expect(grants.mediaRequests).toHaveLength(1);
	expect(grants.releasedSessions).toContain('1'.repeat(64));
	expect(grants.releasedReads).toContain('1'.repeat(64));
});

test('browser File Open rejects SES while preserving existing audio', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const projectId = await editor.getAttribute('data-project-id');
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Legacy.ses', mimeType: 'application/octet-stream', buffer: Buffer.from(sessionFixture()) });
	await expect(page.getByRole('alert')).toContainText('SES import requires the desktop app');
	await expect(editor).toHaveAttribute('data-project-id', projectId);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});

test('a malformed desktop SES releases its media grant and preserves the open project', async ({ page }) => {
	await installSesBridge(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseFileAction(page, editor, 'Open');
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 20_000 });
	const projectId = await editor.getAttribute('data-project-id');
	await page.evaluate(() => { globalThis.__legacySesFixture.nextSession = 1; });
	await chooseFileAction(page, editor, 'Open');
	await expect(page.getByRole('alert')).toContainText('A legacy SES session must start with COOLNESS.');
	await expect(editor).toHaveAttribute('data-project-id', projectId);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect.poll(() => page.evaluate(() => globalThis.__legacySesFixture.releasedSessions)).toContain('2'.repeat(64));
	await expect.poll(() => page.evaluate(() => globalThis.__legacySesFixture.releasedReads)).toContain('2'.repeat(64));
});
