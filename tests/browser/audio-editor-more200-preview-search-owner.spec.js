/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, readFile, test } from './audio-editor-test-fixtures.js';
import { encodeDedicatedAudioPcm } from '../../src/common/editor/browser-dedicated-audio-codec.ts';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

const SOUND = {
	id: 42, name: 'Rain in the garden', pageUrl: 'https://freesound.org/s/42/',
	creator: { username: 'recorder', pageUrl: 'https://freesound.org/people/recorder/' },
	description: '', tags: [], category: null, subcategory: null,
	createdAt: '2026-01-02T03:04:05Z', generativeAiPreference: null, explicit: false,
	license: { code: 'cc0', name: 'Creative Commons 0', url: 'https://creativecommons.org/publicdomain/zero/1.0/',
		requiresAttribution: false, commercialUseAllowed: true },
	durationSeconds: 12, originalFile: { format: 'wav', channels: 1, byteLength: 1_152_044,
		sampleRate: 48_000, md5: '0123456789abcdef0123456789abcdef' },
	statistics: { downloads: 42, averageRating: 4.75, ratingCount: 8 },
	preview: { available: true, format: 'ogg', quality: 'high', approximateBitrateKbps: 192 },
};

for (const outcome of ['replacement', 'failure']) {
	test(`Freesound ${outcome} search keeps real preview audio with its visible controls`, async ({ page, browserName }) => {
		if (browserName === 'firefox') {
			// Probe a plain PCM WAV outside the application before relying on the
			// host's native output. WSLg can reject the sink after play succeeds.
			await page.setContent('<button>Check native audio output</button>');
			await page.evaluate(bytes => {
				globalThis.__more200NativeOutput = new Promise((resolve, reject) => {
					document.querySelector('button').onclick = () => {
						const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }));
						const audio = new Audio(url);
						const finish = value => { resolve(value); audio.pause(); audio.removeAttribute('src'); URL.revokeObjectURL(url); };
						audio.addEventListener('error', () => finish(audio.error?.message ?? 'Unknown native media error'), { once: true });
						audio.addEventListener('timeupdate', () => { if (audio.currentTime > 0.05) finish(null); });
						void audio.play().catch(reject);
					};
				});
			}, [...createWavFixture({ name: 'native-output.wav', frequency: 440, duration: 1, channelCount: 1 }).buffer]);
			await page.getByRole('button', { name: 'Check native audio output' }).click();
			const nativeError = await page.evaluate(() => globalThis.__more200NativeOutput);
			test.skip(nativeError?.includes('OnMediaSinkAudioError'), 'The native Firefox output backend also refuses an independent PCM WAV.');
			expect(nativeError).toBeNull();
		}
		const frameCount = 48_000 * 12;
		const pcm = Float32Array.from({ length: frameCount }, (_, frame) => 0.2 * Math.sin(2 * Math.PI * 440 * frame / 48_000));
		const preview = await encodeDedicatedAudioPcm({ format: 'ogg-vorbis', input: new Uint8Array(pcm.buffer),
			frameCount, channelCount: 1, sampleRate: 48_000, settings: { quality: 4 }, maximumOutputBytes: 1024 * 1024,
		}, { loadPayload: async (_format, url) => readFile(url) });
		await page.addInitScript(() => {
			globalThis.__more200SearchPreviewAudio = [];
			const play = HTMLMediaElement.prototype.play;
			HTMLMediaElement.prototype.play = function () {
				if (this.src.includes('/api/freesound/sounds/')) globalThis.__more200SearchPreviewAudio.push(this);
				return play.call(this);
			};
		});
		let searches = 0;
		let releaseSearch;
		const pendingSearch = new Promise(resolve => { releaseSearch = resolve; });
		await page.route('**/api/freesound/**', async route => {
			const path = new URL(route.request().url()).pathname;
			if (path === '/api/freesound/oauth/session') return route.fulfill({ json: { data: { connected: false } } });
			if (path === '/api/freesound/search') {
				const request = ++searches;
				if (request === 2) {
					await pendingSearch;
					if (outcome === 'failure') return route.fulfill({ status: 503, json: { error: { message: 'Search unavailable' } } });
				}
				return route.fulfill({ json: { data: { query: request === 1 ? 'rain' : 'wind', page: 1, pageSize: 20,
					totalCount: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false,
					results: [request === 1 ? SOUND : { ...SOUND, id: 43, name: 'Wind in the garden' }] } } });
			}
			if (path.endsWith('/preview')) {
				const range = /^bytes=(\d+)-(\d*)$/u.exec(route.request().headers().range ?? '');
				const start = range ? Number(range[1]) : 0;
				const end = range?.[2] ? Math.min(Number(range[2]), preview.byteLength - 1) : preview.byteLength - 1;
				return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/ogg',
					headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${preview.byteLength}` } : {}) },
					body: Buffer.from(preview.subarray(start, end + 1)) });
			}
			return route.fulfill({ status: 404, json: {} });
		});
		try {
			const editor = await bootEditor(page, '/embed/en/');
			await chooseNestedCommandAction(page, editor, 'Window', ['Freesound']);
			const panel = editor.locator('[data-workspace-panel="freesound"]');
			const query = panel.getByRole('searchbox', { name: 'Search Freesound', exact: true });
			await query.fill('rain');
			await panel.getByRole('button', { name: 'Search', exact: true }).click();
			await expect(panel.getByRole('button', { name: `Play preview: ${SOUND.name}`, exact: true })).toBeVisible();
			await query.fill('wind');
			await panel.getByRole('button', { name: 'Search', exact: true }).click();
			await expect.poll(() => searches).toBe(2);
			await panel.getByRole('button', { name: `Play preview: ${SOUND.name}`, exact: true }).click();
			await expect.poll(() => page.evaluate(() => globalThis.__more200SearchPreviewAudio[0]?.currentTime)).toBeGreaterThan(0.05);
			releaseSearch();
			if (outcome === 'replacement') {
				await expect(panel.getByRole('button', { name: 'Play preview: Wind in the garden', exact: true })).toBeVisible();
				await expect.poll(() => page.evaluate(() => globalThis.__more200SearchPreviewAudio[0]?.paused)).toBe(true);
				expect(await page.evaluate(() => globalThis.__more200SearchPreviewAudio[0]?.getAttribute('src'))).toBe('');
				await panel.getByRole('button', { name: 'Play preview: Wind in the garden', exact: true }).click();
				await expect.poll(() => page.evaluate(() => globalThis.__more200SearchPreviewAudio[1]?.currentTime)).toBeGreaterThan(0.05);
			} else {
				await expect(panel.getByRole('alert')).toBeVisible();
				expect(await page.evaluate(() => globalThis.__more200SearchPreviewAudio[0]?.paused)).toBe(false);
				await panel.getByRole('button', { name: `Pause preview: ${SOUND.name}`, exact: true }).click();
				await expect.poll(() => page.evaluate(() => globalThis.__more200SearchPreviewAudio[0]?.paused)).toBe(true);
			}
		} finally { releaseSearch(); }
	});
}
