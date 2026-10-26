/* SPDX-License-Identifier: AGPL-3.0-only */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './audio-editor-test-fixtures.js';
import { AssistanceStagingRegistry } from '../../desktop/assistance-staging-registry.ts';
import { createAssistanceKeyingSourceDecodeService } from '../../desktop/assistance-keyed-video-decode.ts';
import { admittedExternalFfmpeg } from '../helpers/keying-source-decode-fixture.ts';
test.use({ browserCoverage: false });

test('a browser-unsupported ProRes source falls back to authenticated native RGBA decoding', async ({ page }) => {
	const directory = process.env.SCAPE_TEST_ALPHA_FFMPEG_DIRECTORY;
	test.skip(!directory, 'Set SCAPE_TEST_ALPHA_FFMPEG_DIRECTORY for the real ProRes/native decoder workflow.');
	const root = await mkdtemp(join(tmpdir(), 'keying-prores-browser-'));
	const registry = new AssistanceStagingRegistry({ root }); const jobs = new Set(); const events = [];
	const service = createAssistanceKeyingSourceDecodeService({ registry,
		operations: { assertJob(jobId) { if (!jobs.has(jobId)) throw new Error('Unknown decode job'); } },
		preferences: await admittedExternalFfmpeg(directory) });
	try {
		await page.exposeFunction('nativeCreate', async () => { const jobId = await registry.createJob(); jobs.add(jobId); return { contractVersion: 1, jobId }; });
		await page.exposeFunction('nativeStage', async ({ jobId, bytes }) => registry.stageInput({ jobId, role: 'video', mediaType: 'video/quicktime',
			byteLength: bytes.length, bytes: (async function* () { yield Uint8Array.from(bytes); })() }));
		await page.exposeFunction('nativeDecode', async request => { events.push('native-decode'); return service.decode(request); });
		await page.exposeFunction('nativeRead', async request => [...await service.read(request)]);
		await page.exposeFunction('nativeCancel', async jobId => service.cancel(jobId));
		await page.exposeFunction('nativeRelease', async jobId => { await service.cancel(jobId); await registry.releaseJob(jobId); jobs.delete(jobId); events.push('release'); return true; });
		const bundle = await build({ entryPoints: [fileURLToPath(new URL('../../src/common/editor/controller/assistance/internal/video/local-assistance-video-keying-native-decoder.ts', import.meta.url))],
			bundle: true, write: false, format: 'esm', platform: 'browser' });
		const bytes = await readFile(new URL('./fixtures/corridorkey/prores-green.mov', import.meta.url));
		await page.route('/__keying_prores__/**', async route => {
			await route.fulfill(route.request().url().endsWith('.mov') ? { contentType: 'video/quicktime', body: bytes }
				: route.request().url().endsWith('.html') ? { contentType: 'text/html', body: '<!doctype html><title>ProRes keying extraction</title>' }
					: { contentType: 'text/javascript', body: bundle.outputFiles[0].text });
		});
		await page.goto('/__keying_prores__/index.html');
		const samples = await page.evaluate(async root => {
			const { createKeyingVideoDecoderWithNativeFallback } = await import(`${root}/entry.js`);
			const body = await fetch(`${root}/source.mov`).then(response => response.blob());
			const bridge = { createJob: globalThis.nativeCreate, stageInput: async ({ jobId, bytes }) => globalThis.nativeStage({ jobId, bytes: [...new Uint8Array(await bytes.arrayBuffer())] }),
				cancel: globalThis.nativeCancel, release: globalThis.nativeRelease,
				videoKeying: { decodeSource: globalThis.nativeDecode, readDecodedSource: async request => Uint8Array.from(await globalThis.nativeRead(request)) } };
			const signal = new AbortController().signal;
			const decoder = await createKeyingVideoDecoderWithNativeFallback(bridge)(body, { width: 64, height: 64, sourceFrameCount: 3, frameRate: { num: 25, den: 1 } }, signal);
			const values = [];
			try { for (const ordinal of [0, 1, 2, 0]) { const rgba = await decoder.capture((ordinal + 0.5) / 25, signal, ordinal); values.push({ length: rgba.length, pixel: [...rgba.slice(0, 4)] }); } }
			finally { await decoder.dispose(); }
			return values;
		}, '/__keying_prores__');
		expect(samples).toHaveLength(4);
		for (const sample of samples) {
			expect(sample.length).toBe(64 * 64 * 4); expect(sample.pixel[3]).toBe(255);
			expect(sample.pixel[1]).toBeGreaterThan(sample.pixel[0] + 50);
		}
		expect(events).toEqual(['native-decode', 'release']); expect(jobs.size).toBe(0);
	} finally { await service.dispose(); await Promise.all([...jobs].map(jobId => registry.releaseJob(jobId))); await rm(root, { recursive: true, force: true }); }
});
