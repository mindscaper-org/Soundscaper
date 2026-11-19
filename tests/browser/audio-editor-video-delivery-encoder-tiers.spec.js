/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { test } from './audio-editor-test-fixtures.js';
import { bundleSourceModuleRoutes } from './helpers/source-module-routes.ts';
test.use({ browserCoverage: false });
const ROOT = '/__video-delivery-encoder-tiers__';
const ENTRY_MODULES = ['video-delivery-encoder-tier', 'platform-video-delivery-encoder', 'video-webcodecs-producer'];
/** 29.97, stated as the rational a decimal would quietly round away. */
const FRAME_RATE = { num: 30_000, den: 1_001 };
const CANVAS = { width: 64, height: 64 };

test('an eligible Chromium delivery chooses its browser-native encoder explicitly', async ({
	browserName,
	page,
}) => {
	test.skip(browserName !== 'chromium', 'The native delivery-tier witness needs Chromium.');
	const requestedUrls = [];
	page.on('request', (request) => { requestedUrls.push(request.url()); });
	await installRoutes(page);
	await page.goto(`${ROOT}/index.html`);
	const result = await page.evaluate(async ([root, rate, canvas]) => {
		const tierModule = await import(
			`${root}/src/common/editor/video-delivery-encoder-tier.js`
		);
		const decision = await tierModule.resolveVideoDeliveryEncoderTier({
			format: 'mp4',
			canvas: { ...canvas, frameRate: rate },
			quality: 'balanced',
			eligible: true,
		});
		return {
			...decision,
			crossOriginIsolated,
			hasSharedArrayBuffer: typeof SharedArrayBuffer === 'function',
		};
	}, [ROOT, FRAME_RATE, CANVAS]);

	expect(requestedUrls.filter(isFfmpegRuntimeRequest)).toEqual([]);
	expect(result).toMatchObject({
		tier: 'webcodecs',
		reason: null,
		crossOriginIsolated: false,
		hasSharedArrayBuffer: false,
	});
	expect(result.codec).toMatch(/^avc1\./u);
	expect(result.bitrate).toBe(64_000);
});

test('absent and ineligible browser encoders are explicit unavailable errors', async ({ page }) => {
	await installRoutes(page);
	await page.goto(`${ROOT}/index.html`);
	const result = await page.evaluate(async ([root, rate, canvas]) => {
		const tierModule = await import(
			`${root}/src/common/editor/video-delivery-encoder-tier.js`
		);
		const request = {
			format: 'mp4',
			canvas: { ...canvas, frameRate: rate },
			quality: 'balanced',
			eligible: true,
		};
		return {
			absent: await capture(() => tierModule.resolveVideoDeliveryEncoderTier(request, null)),
			ineligible: await capture(() => tierModule.resolveVideoDeliveryEncoderTier({
				...request,
				eligible: false,
			})),
		};

		async function capture(operation) {
			try {
				await operation();
				return { resolved: true };
			} catch (error) {
				return {
					resolved: false,
					name: error?.name,
					code: error?.code,
					message: error?.message,
					isUnavailable: error instanceof tierModule.BrowserVideoEncoderUnavailableError,
				};
			}
		}
	}, [ROOT, FRAME_RATE, CANVAS]);

	for (const refusal of [result.absent, result.ineligible]) {
		expect(refusal).toMatchObject({
			resolved: false,
			name: 'BrowserVideoEncoderUnavailableError',
			code: 'BROWSER_VIDEO_ENCODER_UNAVAILABLE',
			isUnavailable: true,
		});
		expect(refusal.message).toMatch(/^Browser-native video export is unavailable:/u);
	}
	expect(result.absent.message).toMatch(/encoder/u);
	expect(result.ineligible.message).toMatch(/keyed frame delivery/u);
});

test('desktop delivery uses real WebCodecs without an external FFmpeg provider', async ({ browserName, page }) => {
	test.skip(browserName !== 'chromium', 'Electron runs its native codec composition in Chromium.');
	await installRoutes(page);
	await page.goto(`${ROOT}/index.html`);
	const result = await page.evaluate(async ([root, rate, canvas]) => {
		const { resolvePlatformVideoDeliveryEncoder, resolveDesktopRendererVideoExportCapabilities } = await import(
			`${root}/src/common/editor/platform-video-delivery-encoder.js`
		);
		const { produceVideoWebCodecsChunks } = await import(`${root}/src/common/editor/video-webcodecs-producer.js`);
		const fileService = { isDesktop: true };
		const capabilities = await resolveDesktopRendererVideoExportCapabilities(fileService);
		const decision = await resolvePlatformVideoDeliveryEncoder(fileService, {
			format: 'mp4', canvas: { ...canvas, frameRate: rate }, quality: 'balanced', eligible: true,
		});
		let chunks = 0;
		let bytes = 0;
		await produceVideoWebCodecsChunks({
			frameSource: { frameCount: 2, canvas: { ...canvas, frameRate: rate }, frame: (index) => ({ index }) },
			producer: { byteLength: canvas.width * canvas.height * 4, produce: (_frame, target) => { target.fill(128); } },
			videoCodec: 'h264', codec: decision.codec, bitrate: decision.bitrate,
			...(decision.hardwareAcceleration ? { hardwareAcceleration: decision.hardwareAcceleration } : {}),
			h264Format: 'avc', encoderClass: VideoEncoder, videoFrameClass: VideoFrame,
			writeChunk(chunk) { chunks += 1; bytes += chunk.byteLength; },
		});
		return { decision, available: capabilities.formats.mp4.available, chunks, bytes };
	}, [ROOT, FRAME_RATE, CANVAS]);
	expect(result.available).toBe(true);
	expect(result.decision.tier).toBe('webcodecs');
	expect(result.chunks).toBe(2);
	expect(result.bytes).toBeGreaterThan(0);
});

function isFfmpegRuntimeRequest(value) {
	const url = new URL(value);
	return url.pathname.includes('/node_modules/@ffmpeg/')
		|| url.pathname.includes('/ffmpeg/')
		|| url.pathname.includes('/core/ffmpeg-core');
}

async function installRoutes(page) {
	const sourceRoot = new URL('../../src/', import.meta.url);
	const entries = ENTRY_MODULES.map(name => new URL(`common/editor/${name}.ts`, sourceRoot));
	const routes = await bundleSourceModuleRoutes(sourceRoot, `${ROOT}/src`, entries);
	await page.route(`**${ROOT}/**`, async (route) => {
		const pathname = new URL(route.request().url()).pathname;
		if (pathname === `${ROOT}/index.html`) {
			await route.fulfill({
				status: 200,
				contentType: 'text/html',
				body: '<!doctype html><meta charset="utf-8"><title>video delivery encoder tier</title>',
			});
			return;
		}
		const descriptor = routes.get(pathname);
		await route.fulfill(descriptor === undefined
			? { status: 404, body: `Unknown fixture path ${pathname}` }
			: { status: 200, ...descriptor });
	});
}
