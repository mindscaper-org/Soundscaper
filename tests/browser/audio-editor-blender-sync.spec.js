/* SPDX-License-Identifier: AGPL-3.0-only */

import { installDesktopSpeedWarmupManifest } from './helpers/desktop-speed-warmup-fixture.js';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, getMenuItem, importFiles, openNestedCommandMenu } from './audio-editor-test-helpers.js';

const AUDIO = createWavFixture({ name: 'blender-voice.wav', frequency: 440, duration: 0.1, channelCount: 1, sampleRate: 48_000 });
test.setTimeout(60_000);

test('desktop Blender export renders WAVs and live sync updates edits until stopped', async ({ page }) => {
	await installBlenderFixture(page);
	const editor = await bootEditor(page, '/embed/en/');
	await expect(editor.getByRole('button', { name: /Blender/iu })).toHaveCount(0);
	await importFiles(editor, [AUDIO]);
	const exportReady = dismissCompletionNotice(page, 'The Blender bundle is ready.');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export track list for Blender']);
	await exportReady;
	await expect.poll(() => page.evaluate(() => globalThis.__blenderProbe.commits.length)).toBe(1);
	const first = await page.evaluate(() => globalThis.__blenderProbe.commits[0]);
	expect(first.tracks).toHaveLength(1);
	expect(first.tracks[0]).toMatchObject({ startSeconds: 0, mute: false });
	expect(first.wavHeaders).toEqual(['RIFF']);
	expect(first.chunkSizes.every((size) => size > 0 && size <= 4 * 1024 * 1024)).toBe(true);
	const syncReady = dismissCompletionNotice(page, 'Live Blender sync is running.');
	const startMenu = await openNestedCommandMenu(page, editor, 'Tools', ['Desktop services']);
	await expect(getMenuItem(startMenu, 'Start live Blender sync')).toBeEnabled();
	await getMenuItem(startMenu, 'Start live Blender sync').press('Enter');
	await syncReady;
	await expect.poll(() => page.evaluate(() => globalThis.__blenderProbe.commits.length)).toBe(2);
	const tools = await openNestedCommandMenu(page, editor, 'Tools', ['Desktop services']);
	await expect(getMenuItem(tools, 'Stop live Blender sync')).toBeEnabled();
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	const track = editor.locator(`[data-track-row][data-track-id="${first.tracks[0].id}"]`);
	await track.getByRole('button', { name: 'Mute', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__blenderProbe.commits.at(-1)?.tracks[0]?.mute)).toBe(true);
	const latest = await page.evaluate(() => globalThis.__blenderProbe.commits.at(-1));
	expect(latest.tracks[0].id).toBe(first.tracks[0].id);
	expect(latest.tracks[0].mute).toBe(true);
	await chooseNestedCommandAction(page, editor, 'Tools', ['Desktop services', 'Stop live Blender sync']);
	await expect.poll(() => page.evaluate(() => globalThis.__blenderProbe.stops.length)).toBe(2);
	const { beginCount, commitCount } = await page.evaluate(() => ({
		beginCount: globalThis.__blenderProbe.begins.length,
		commitCount: globalThis.__blenderProbe.commits.length,
	}));
	// Preserve the full debounce observation window after live sync has stopped.
	await page.clock.install();
	await track.getByRole('button', { name: 'Mute', exact: true }).click();
	await expect(track.getByRole('button', { name: 'Mute', exact: true })).toHaveAttribute('aria-pressed', 'false');
	await page.clock.fastForward(500);
	expect(await page.evaluate(() => ({
		beginCount: globalThis.__blenderProbe.begins.length,
		commitCount: globalThis.__blenderProbe.commits.length,
	}))).toEqual({ beginCount, commitCount });
});

test('browser Blender commands offer the desktop app while Framescaper omits them', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const tools = await openNestedCommandMenu(page, editor, 'Tools', []);
	await expect(getMenuItem(tools, 'Start live Blender sync')).toHaveCount(0);
	await chooseNestedCommandAction(page, editor, 'Tools', ['Desktop services', 'Start live Blender sync']);
	const dialog = page.getByRole('dialog', { name: 'Desktop feature', exact: true });
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await installBlenderFixture(page);
	const framescaper = await bootEditor(page, '/framescaper/embed/en/');
	const framescaperTools = await openNestedCommandMenu(page, framescaper, 'Tools', []);
	await expect(getMenuItem(framescaperTools, 'Start live Blender sync')).toHaveCount(0);
});

async function dismissCompletionNotice(page, message) {
	const dialog = await page.waitForEvent('dialog');
	const actualMessage = dialog.message();
	await dialog.dismiss();
	expect(actualMessage).toContain(message);
}

async function installBlenderFixture(page) {
	await installDesktopSpeedWarmupManifest(page);
	await page.addInitScript(() => {
		const probe = { begins: [], commits: [], stops: [], current: null, chunks: [], selects: [] };
		let sessionIndex = 0;
		const bridge = { getEnvironment: async () => null,
			signalReady: async () => undefined,
			onMenuCommand: () => () => undefined, onOpenProject: () => () => undefined,
			onCloseRequested: () => () => undefined, onWindowStateChanged: () => () => undefined,
			blender: {
				select: async ({ live }) => { probe.selects.push(live); return { sessionId: `blender-session-${String(++sessionIndex)}` }; },
				begin: async (value) => { probe.begins.push(value); probe.current = value; probe.chunks = []; return { publicationId: 'publication' }; },
				write: async (value) => { probe.chunks.push({ trackId: value.trackId, offset: value.offset, bytes: Array.from(value.bytes) }); },
				commit: async () => { probe.commits.push({ tracks: probe.current.tracks,
					wavHeaders: probe.chunks.filter(({ offset }) => offset === 0).map(({ bytes }) => String.fromCharCode(...bytes.slice(0, 4))),
					chunkSizes: probe.chunks.map(({ bytes }) => bytes.length) }); return { revision: probe.commits.length }; },
				abort: async () => undefined,
				stop: async (value) => { probe.stops.push(value); },
			},
		};
		globalThis.__blenderProbe = probe;
		globalThis.soundscaperDesktop = Object.freeze({ v1: Object.freeze(bridge) });
	});
}
