import { expect } from '@playwright/test';
import { test } from './audio-editor-test-fixtures.js';
import { requireNativeGpuCapabilityCurrentV1 } from './helpers/lightscaper-native-gpu-capability-current.ts';
import { readFile } from 'node:fs/promises';
import { buildVideoFfmpegArgs } from '../../src/common/editor/video-ffmpeg.js';
import { PARITY_CASES, SCALED_PARITY_CASES, effect } from './video-effect-parity-cases.ts';
import {
	VIDEO_EFFECT_PARITY_HEIGHT,
	VIDEO_EFFECT_PARITY_MAXIMUM_CHANNEL_MAE,
	VIDEO_EFFECT_PARITY_MINIMUM_SSIM,
	VIDEO_EFFECT_PARITY_WIDTH,
	auditVignetteAlpha,
	compareVideoEffectFrames,
	createVideoEffectParityFixture,
	rgbaToPpm,
} from './video-effect-parity-helpers.js';
import { videoPreviewSourceResponse } from './video-preview-source-route.js';
test.use({ browserCoverage: false });
const PARITY_ROUTE_ROOT = '/__video-effect-parity__';
const RUNTIME_ROUTES = new Map([
	[`${PARITY_ROUTE_ROOT}/ffmpeg/classes.js`, {
		file: new URL('../../node_modules/@ffmpeg/ffmpeg/dist/esm/classes.js', import.meta.url),
		contentType: 'text/javascript',
	}],
	[`${PARITY_ROUTE_ROOT}/ffmpeg/const.js`, {
		file: new URL('../../node_modules/@ffmpeg/ffmpeg/dist/esm/const.js', import.meta.url),
		contentType: 'text/javascript',
	}],
	[`${PARITY_ROUTE_ROOT}/ffmpeg/errors.js`, {
		file: new URL('../../node_modules/@ffmpeg/ffmpeg/dist/esm/errors.js', import.meta.url),
		contentType: 'text/javascript',
	}],
	[`${PARITY_ROUTE_ROOT}/ffmpeg/utils.js`, {
		file: new URL('../../node_modules/@ffmpeg/ffmpeg/dist/esm/utils.js', import.meta.url),
		contentType: 'text/javascript',
	}],
	[`${PARITY_ROUTE_ROOT}/ffmpeg/worker.js`, {
		file: new URL('../../node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js', import.meta.url),
		contentType: 'text/javascript',
	}],
	[`${PARITY_ROUTE_ROOT}/core/ffmpeg-core.js`, {
		file: new URL('../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', import.meta.url),
		contentType: 'text/javascript',
	}],
	[`${PARITY_ROUTE_ROOT}/core/ffmpeg-core.wasm`, {
		file: new URL('../../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', import.meta.url),
		contentType: 'application/wasm',
	}],
]);


test('actual DOM Grain31 keeps asymmetric top-origin seed coordinates', async ({ page }) => {
	await requireNativeGpuCapabilityCurrentV1(page, test.info(), 'webgl2');
	await installParityRuntimeRoutes(page);
	await page.goto(`${PARITY_ROUTE_ROOT}/index.html`);
	const source = [40, 80, 120, 100, 140, 180, 160, 200, 240].flatMap(value => [value, value, value, 255]);
	const result = await page.evaluate(async ({ root, source, grain }) => {
		const { VideoPreviewCompositor } = await import(`${root}/source/common/editor/ui/video-preview-compositor.js`);
		const drawable = document.createElement('canvas'); drawable.width = 3; drawable.height = 3;
		const context = drawable.getContext('2d');
		context.putImageData(new ImageData(new Uint8ClampedArray(source), 3, 3), 0, 0);
		Object.defineProperties(drawable, { videoWidth: { value: 3 }, videoHeight: { value: 3 }, readyState: { value: 4 } });
		const canvas = document.createElement('canvas'); document.body.append(canvas);
		const compositor = new VideoPreviewCompositor(canvas), gl = compositor.gl;
		const pixels = new Uint8Array(36);
		try {
			const report = compositor.render([{ entries: [{ video: drawable, effects: [grain], opacity: 1 }] }],
				{ outputWidth: 3, outputHeight: 3, referenceWidth: 3, referenceHeight: 3, outputColorModel: 'rgba' });
			gl.finish(); gl.readPixels(0, 0, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
			const top = new Uint8Array(36);
			for (let y = 0; y < 3; y++) top.set(pixels.subarray((2 - y) * 12, (3 - y) * 12), y * 12);
			return { pixels: [...top], source: [...context.getImageData(0, 0, 3, 3).data], report,
				nativeWebgl2: gl instanceof WebGL2RenderingContext, glError: gl.getError() };
		} finally { pixels.fill(0); compositor.dispose(); canvas.remove(); drawable.width = 0; drawable.height = 0; }
	}, { root: PARITY_ROUTE_ROOT, source, grain: effect('grain-v1', { amount: 50, size: 1, roughness: 50, seed: 2718 }) });
	// Independent integer lattice/envelope literal; no production scalar computes it.
	expect(result.pixels).toEqual([40, 82, 120, 97, 142, 180, 160, 199, 240].flatMap(value => [value, value, value, 255]));
	expect(result.source).toEqual(source); expect(result.nativeWebgl2).toBe(true); expect(result.glError).toBe(0);
	expect(result.report.status).toBe('rendered'); expect(result.report.renderedEntryCount).toBe(1);
	expect(result.report.effects.omitted).toEqual([]); expect(result.report.effects.fallbackRendered).toEqual([]);
});

test('WebGL preview stays within the calibrated FFmpeg golden-frame thresholds', async ({ page }, testInfo) => {
	test.skip(
		process.env.AUDIO_EDITOR_FFMPEG_BROWSER !== '1',
		'Enable for the pinned 31 MB FFmpeg/WebGL parity check.',
	);
	test.setTimeout(300_000);
	await installParityRuntimeRoutes(page);
	await page.goto(`${PARITY_ROUTE_ROOT}/index.html`);
	await initializeParityRuntime(page);
	const transparencyFixture = createVideoEffectParityFixture('transparency');
	const vignetteGraph = effectFilterGraph(
		[effect('vignette')],
		transparencyFixture.width,
		transparencyFixture.height,
	);
	const vignetteExpression = vignetteGraph.match(/vignette=[^[]+/)?.[0]?.split(',')[0];
	expect(vignetteExpression, 'The production graph must contain the allowlisted vignette filter.').toBeTruthy();
	const alphaAudit = await auditVignetteAlpha(page, {
		width: transparencyFixture.width,
		height: transparencyFixture.height,
		inputBase64: Buffer.from(transparencyFixture.bytes).toString('base64'),
		vignetteExpression,
		clipGraph: isolatedFirstClipGraph(vignetteGraph),
	});
	const opaqueFixture = createVideoEffectParityFixture('gradient');
	const opaqueVignetteAudit = await auditVignetteAlpha(page, {
		width: opaqueFixture.width,
		height: opaqueFixture.height,
		inputBase64: Buffer.from(opaqueFixture.bytes).toString('base64'),
		vignetteExpression,
		clipGraph: isolatedFirstClipGraph(vignetteGraph),
		filePrefix: 'opaque-',
	});

	const results = [];
	const collectResult = async (metadata, rendered, width, height) => {
		const preview = new Uint8Array(Buffer.from(rendered.previewBase64, 'base64'));
		const exported = new Uint8Array(Buffer.from(rendered.exportBase64, 'base64'));
		const metrics = compareVideoEffectFrames(preview, exported, width, height);
		const result = { ...metadata, ...metrics };
		results.push(result);
		const failed = metrics.ssim < VIDEO_EFFECT_PARITY_MINIMUM_SSIM
			|| Object.values(metrics.channelMae).some((mae) => mae > VIDEO_EFFECT_PARITY_MAXIMUM_CHANNEL_MAE);
		if (failed) {
			await testInfo.attach(`${metadata.name}-preview.ppm`, {
				body: rgbaToPpm(preview, width, height),
				contentType: 'image/x-portable-pixmap',
			});
			await testInfo.attach(`${metadata.name}-ffmpeg.ppm`, {
				body: rgbaToPpm(exported, width, height),
				contentType: 'image/x-portable-pixmap',
			});
		}
	};
	const caseFilter = process.env.SOUNDSCAPER_VIDEO_EFFECT_PARITY_CASE;
	const selectedCaseNames = new Set(caseFilter?.split(',').map((name) => name.trim()).filter(Boolean));
	const parityCases = caseFilter
		? PARITY_CASES.filter((parity) => selectedCaseNames.has(parity.name))
		: PARITY_CASES;
	for (const parity of parityCases) {
		const fixture = createVideoEffectParityFixture(parity.fixture);
		const graph = effectFilterGraph(parity.effects, fixture.width, fixture.height);
		const rendered = await renderParityCase(page, {
			...parity,
			graph,
			width: fixture.width,
			height: fixture.height,
			inputBase64: Buffer.from(fixture.bytes).toString('base64'),
		});
		await collectResult(
			{ name: parity.name, fixture: parity.fixture, effects: parity.effects },
			rendered,
			fixture.width,
			fixture.height,
		);
	}

	const scaledFixture = createVideoEffectParityFixture('gradient');
	const scaledCases = SCALED_PARITY_CASES;
	for (const [name, scaledEffects] of caseFilter
		? scaledCases.filter(([name]) => selectedCaseNames.has(name))
		: scaledCases) {
		const scaledRendered = await renderParityCase(page, {
			name,
			graph: effectFilterGraph(scaledEffects, scaledFixture.width, scaledFixture.height),
			width: scaledFixture.width,
			height: scaledFixture.height,
			panelWidth: scaledFixture.width * 2,
			panelHeight: scaledFixture.height * 2 + 32,
			inputBase64: Buffer.from(scaledFixture.bytes).toString('base64'),
			effects: scaledEffects,
		});
		expect(
			scaledRendered.letterboxMismatchedPixels,
			'The physical-panel letterbox must remain opaque black outside the export canvas.',
		).toBe(0);
		await collectResult(
			{ name, fixture: 'gradient', effects: scaledEffects, panelScale: 2 },
			scaledRendered,
			scaledFixture.width,
			scaledFixture.height,
		);
	}

	const alternateTransparency = alternateTransparencyFixture(transparencyFixture);
	for (const composition of caseFilter ? [] : [
		{
			name: 'transparent-layered-clips',
			kind: 'layered',
			layers: [
				[{ sourceIndex: 0, effects: [], opacity: 1 }],
				[{ sourceIndex: 1, effects: [], opacity: 1 }],
			],
		},
		{
			name: 'transparent-crossfade',
			kind: 'crossfade',
			layers: [[
				{ sourceIndex: 0, effects: [], opacity: 0.75 },
				{ sourceIndex: 1, effects: [], opacity: 0.25 },
			]],
		},
	]) {
		const rendered = await renderCompositionParityCase(page, {
			name: composition.name,
			graph: compositionFilterGraph(
				composition.kind,
				transparencyFixture.width,
				transparencyFixture.height,
			),
			width: transparencyFixture.width,
			height: transparencyFixture.height,
			inputBase64s: [transparencyFixture, alternateTransparency].map(
				(fixture) => Buffer.from(fixture.bytes).toString('base64'),
			),
			layers: composition.layers,
		});
		await collectResult(
			{ name: composition.name, fixture: 'transparency', effects: [], composition: composition.kind },
			rendered,
			transparencyFixture.width,
			transparencyFixture.height,
		);
	}

	await testInfo.attach('video-effect-parity-metrics.json', {
		body: Buffer.from(JSON.stringify({
			core: '@ffmpeg/core@0.12.10',
			alphaAudit,
			opaqueVignetteAudit,
			thresholds: {
				minimumSsim: VIDEO_EFFECT_PARITY_MINIMUM_SSIM,
				maximumPerChannelMae: VIDEO_EFFECT_PARITY_MAXIMUM_CHANNEL_MAE,
			},
			results,
		}, null, 2)),
		contentType: 'application/json',
	});
	console.info(`Video effect parity audit:\n${JSON.stringify({ alphaAudit, opaqueVignetteAudit, results }, null, 2)}`);
	expect(alphaAudit.mismatchedPixels, 'Vignette must retain every source alpha value before composition.').toBe(0);
	expect(alphaAudit.maximumDelta, 'Vignette must not alter source alpha before composition.').toBe(0);
	expect(alphaAudit.referenceRgbMaximum, 'The FFmpeg vignette reference must retain visible color.').toBeGreaterThan(0);
	expect(alphaAudit.outputRgbMaximum, 'The alpha-preserving vignette branch must retain visible color.').toBeGreaterThan(0);
	expect(alphaAudit.premultipliedRgbMaximum, 'The transparent vignette must remain visible after premultiplication.').toBeGreaterThan(0);
	expect(alphaAudit.mismatchedColorValues, 'Alpha preservation must not change vignette RGB values.').toBe(0);
	expect(alphaAudit.maximumColorDelta, 'Alpha preservation must not change the vignette color plane.').toBe(0);
	expect(alphaAudit.productionClipByteLength, 'The exact transparent production branch must emit one complete RGBA frame.').toBe(
		transparencyFixture.width * transparencyFixture.height * 4,
	);
	expect(alphaAudit.productionClipRgbMaximum, 'The exact transparent production branch must retain visible color.').toBeGreaterThan(0);
	expect(opaqueVignetteAudit.referenceRgbMaximum, 'The opaque vignette reference must retain visible color.').toBeGreaterThan(0);
	expect(opaqueVignetteAudit.outputRgbMaximum, 'The opaque alpha-preserving vignette branch must retain visible color.').toBeGreaterThan(0);
	expect(opaqueVignetteAudit.premultipliedRgbMaximum, 'The opaque vignette must remain visible after premultiplication.').toBeGreaterThan(0);
	expect(opaqueVignetteAudit.mismatchedColorValues, 'Opaque alpha preservation must retain vignette RGB values.').toBe(0);
	expect(opaqueVignetteAudit.productionClipByteLength, 'The exact opaque production branch must emit one complete RGBA frame.').toBe(
		opaqueFixture.width * opaqueFixture.height * 4,
	);
	expect(opaqueVignetteAudit.productionClipRgbMaximum, 'The exact opaque production branch must retain visible color.').toBeGreaterThan(0);

	for (const result of results) {
		expect.soft(
			result.ssim,
			`${result.name} SSIM must be at least ${VIDEO_EFFECT_PARITY_MINIMUM_SSIM}.`,
		).toBeGreaterThanOrEqual(VIDEO_EFFECT_PARITY_MINIMUM_SSIM);
		for (const [channel, mae] of Object.entries(result.channelMae)) {
			expect.soft(
				mae,
				`${result.name} ${channel} MAE must be at most ${VIDEO_EFFECT_PARITY_MAXIMUM_CHANNEL_MAE}.`,
			).toBeLessThanOrEqual(VIDEO_EFFECT_PARITY_MAXIMUM_CHANNEL_MAE);
		}
	}
});


function effectFilterGraph(effects, width, height) {
	const plan = {
		version: 4,
		format: 'mp4',
		container: 'mp4',
		durationSeconds: 1,
		canvas: {
			width,
			height,
			frameRate: 1,
			pixelFormat: 'yuv420p',
			backgroundColor: '#000000',
		},
		codecs: {
			videoEncoder: 'libx264',
			audioEncoder: null,
			pixelFormat: 'yuv420p',
		},
		inputs: [{ kind: 'video-source', inputIndex: 0, sourceId: 'fixture' }],
		intervals: [{
			kind: 'composition',
			durationSeconds: 1,
			layers: [{
				trackId: 'fixture-track',
				clips: [{
					role: 'single',
					inputIndex: 0,
					sourceId: 'fixture',
					sourceStartTimeSeconds: 0,
					sourceEndTimeSeconds: 1,
					playbackRate: 1,
					opacityStart: 1,
					opacityEnd: 1,
					videoEffects: effects,
				}],
			}],
		}],
		filterPlan: { audio: { strategy: 'none' } },
	};
	const args = buildVideoFfmpegArgs(plan, {
		videoInputPaths: { fixture: 'fixture.rgba' },
	}, 'unused.mp4');
	return args[args.indexOf('-filter_complex') + 1];
}

function isolatedFirstClipGraph(graph) {
	const outputLabel = 'video_interval_0_track_0_clip_0';
	const segments = graph.split(';');
	const first = segments.findIndex((segment) => segment.startsWith('[0:v:0]'));
	const last = segments.findIndex((segment, index) => (
		index >= first && segment.endsWith(`[${outputLabel}]`)
	));
	if (first < 0 || last < first) throw new Error('Unable to isolate the production clip graph.');
	return { graph: segments.slice(first, last + 1).join(';'), outputLabel };
}

function compositionFilterGraph(kind, width, height) {
	if (kind !== 'layered' && kind !== 'crossfade') {
		throw new RangeError(`Unsupported parity composition: ${kind}.`);
	}
	const clip = (inputIndex, role, opacityStart, opacityEnd) => ({
		role,
		inputIndex,
		sourceId: `fixture-${inputIndex}`,
		sourceStartTimeSeconds: 0,
		sourceEndTimeSeconds: 1,
		playbackRate: 1,
		opacityStart,
		opacityEnd,
		videoEffects: [],
	});
	const layers = kind === 'layered'
		? [
			{ trackId: 'fixture-lower', clips: [clip(0, 'single', 1, 1)] },
			{ trackId: 'fixture-upper', clips: [clip(1, 'single', 1, 1)] },
		]
		: [{
			trackId: 'fixture-crossfade',
			clips: [
				clip(0, 'outgoing', 0.75, 0.25),
				clip(1, 'incoming', 0.25, 0.75),
			],
		}];
	const plan = {
		version: 3,
		format: 'mp4',
		container: 'mp4',
		durationSeconds: 1,
		canvas: {
			width,
			height,
			frameRate: 1,
			pixelFormat: 'yuv420p',
			backgroundColor: '#000000',
		},
		codecs: {
			videoEncoder: 'libx264',
			audioEncoder: null,
			pixelFormat: 'yuv420p',
		},
		inputs: [0, 1].map((inputIndex) => ({
			kind: 'video-source',
			inputIndex,
			sourceId: `fixture-${inputIndex}`,
		})),
		intervals: [{ kind: 'composition', durationSeconds: 1, layers }],
		filterPlan: { audio: { strategy: 'none' } },
	};
	const args = buildVideoFfmpegArgs(plan, {
		videoInputPaths: {
			'fixture-0': 'fixture-0.rgba',
			'fixture-1': 'fixture-1.rgba',
		},
	}, 'unused.mp4');
	return args[args.indexOf('-filter_complex') + 1];
}

function alternateTransparencyFixture(fixture) {
	const bytes = new Uint8Array(fixture.bytes.length);
	for (let y = 0; y < fixture.height; y += 1) {
		for (let x = 0; x < fixture.width; x += 1) {
			const target = (y * fixture.width + x) * 4;
			bytes[target] = Math.round(224 - 160 * x / Math.max(1, fixture.width - 1));
			bytes[target + 1] = Math.round(40 + 176 * y / Math.max(1, fixture.height - 1));
			bytes[target + 2] = Math.round(64 + 128 * (x + y) / Math.max(1, fixture.width + fixture.height - 2));
			bytes[target + 3] = Math.round(48 + 160 * (fixture.width - 1 - x) / Math.max(1, fixture.width - 1));
		}
	}
	return { ...fixture, name: 'transparency-alternate', bytes };
}

async function installParityRuntimeRoutes(page) {
	await page.route(`**${PARITY_ROUTE_ROOT}/**`, async (route) => {
		const pathname = new URL(route.request().url()).pathname;
		if (pathname === `${PARITY_ROUTE_ROOT}/index.html`) {
			await route.fulfill({
				status: 200,
				contentType: 'text/html',
				body: '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}</style>',
			});
			return;
		}
		const source = await videoPreviewSourceResponse(pathname, PARITY_ROUTE_ROOT);
		if (source) {
			await route.fulfill({ status: 200, ...source });
			return;
		}
		const descriptor = RUNTIME_ROUTES.get(pathname);
		if (!descriptor) {
			await route.fulfill({ status: 404, body: 'Not found' });
			return;
		}
		const body = await readFile(descriptor.file);
		await route.fulfill({
			status: 200,
			contentType: descriptor.contentType,
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Content-Length': String(body.byteLength),
			},
			body,
		});
	});
}

async function initializeParityRuntime(page) {
	await page.evaluate(async (root) => {
		const [{ FFmpeg }, { VideoPreviewCompositor }] = await Promise.all([
			import(`${root}/ffmpeg/classes.js`),
			import(`${root}/source/common/editor/ui/video-preview-compositor.js`),
		]);
		const logs = [];
		const ffmpeg = new FFmpeg();
		ffmpeg.on('log', ({ type, message }) => {
			logs.push(`${type}: ${message}`);
			if (logs.length > 200) logs.shift();
		});
		await ffmpeg.load({
			classWorkerURL: `${root}/ffmpeg/worker.js`,
			coreURL: `${root}/core/ffmpeg-core.js`,
			wasmURL: `${root}/core/ffmpeg-core.wasm`,
		});
		window.__videoEffectParity = { FFmpeg, VideoPreviewCompositor, ffmpeg, logs };
	}, PARITY_ROUTE_ROOT);
}

async function renderParityCase(page, parity) {
	return renderCompositionParityCase(page, {
		name: parity.name,
		graph: parity.graph,
		width: parity.width,
		height: parity.height,
		panelWidth: parity.panelWidth,
		panelHeight: parity.panelHeight,
		inputBase64s: [parity.inputBase64],
		layers: [[{ sourceIndex: 0, effects: parity.effects, opacity: 1 }]],
	});
}

async function renderCompositionParityCase(page, parity) {
	return page.evaluate(async ({
		name,
		graph,
		width,
		height,
		panelWidth = width,
		panelHeight = height,
		inputBase64s,
		layers,
	}) => {
		const runtime = window.__videoEffectParity;
		const inputs = inputBase64s.map((inputBase64) => (
			Uint8Array.from(atob(inputBase64), (value) => value.charCodeAt(0))
		));
		document.body.replaceChildren();
		const sources = inputs.map((input) => {
			const source = document.createElement('canvas');
			source.width = width;
			source.height = height;
			Object.defineProperties(source, {
				videoWidth: { configurable: true, get: () => width },
				videoHeight: { configurable: true, get: () => height },
				readyState: { configurable: true, get: () => 4 },
			});
			const sourceContext = source.getContext('2d');
			sourceContext.putImageData(new ImageData(new Uint8ClampedArray(input), width, height), 0, 0);
			return source;
		});

		const output = document.createElement('canvas');
		output.style.width = `${panelWidth}px`;
		output.style.height = `${panelHeight}px`;
		document.body.append(output);
		const compositor = new runtime.VideoPreviewCompositor(output);
		const previewLayers = layers.map((layer) => ({
			entries: layer.map((entry) => ({
				video: sources[entry.sourceIndex],
				effects: entry.effects,
				opacity: entry.opacity,
			})),
		}));
		const report = compositor.render(previewLayers, { referenceWidth: width, referenceHeight: height });
		const expectedCount = layers.reduce((total, layer) => total + layer.length, 0);
		if (report.renderedEntryCount !== expectedCount) {
			throw new Error(`Preview rendered ${report.renderedEntryCount} fixture entries instead of ${expectedCount}.`);
		}
		const gl = compositor.gl;
		gl.finish();
		const outputWidth = output.width;
		const outputHeight = output.height;
		const bottomUp = new Uint8Array(outputWidth * outputHeight * 4);
		gl.readPixels(0, 0, outputWidth, outputHeight, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
		if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL readback failed.');
		const fullPreview = flipRgbaRows(bottomUp, outputWidth, outputHeight);
		const previewScale = Math.min(outputWidth / width, outputHeight / height);
		const previewWidth = Math.max(1, Math.round(width * previewScale));
		const previewHeight = Math.max(1, Math.round(height * previewScale));
		const previewX = Math.round((outputWidth - previewWidth) / 2);
		const previewY = Math.round((outputHeight - previewHeight) / 2);
		let letterboxMismatchedPixels = 0;
		for (let y = 0; y < outputHeight; y += 1) {
			for (let x = 0; x < outputWidth; x += 1) {
				if (
				x >= previewX && x < previewX + previewWidth
				&& y >= previewY && y < previewY + previewHeight
				) continue;
				const offset = (y * outputWidth + x) * 4;
				if (
					fullPreview[offset] !== 0
					|| fullPreview[offset + 1] !== 0
					|| fullPreview[offset + 2] !== 0
					|| fullPreview[offset + 3] !== 255
				) letterboxMismatchedPixels += 1;
			}
		}
		const preview = boxResampleRgba(
			fullPreview,
			outputWidth,
			previewX,
			previewY,
			previewWidth,
			previewHeight,
			width,
			height,
		);
		compositor.dispose();

		const safeName = name.replace(/[^a-z0-9-]+/gi, '-');
		const inputNames = inputs.map((input, index) => `${safeName}-${index}.rgba`);
		const outputName = `${safeName}-ffmpeg.rgba`;
		const logOffset = runtime.logs.length;
		try {
			for (const [index, input] of inputs.entries()) {
				await runtime.ffmpeg.writeFile(inputNames[index], input.slice());
			}
			const inputArgs = inputNames.flatMap((inputName) => [
				'-f', 'rawvideo',
				'-pixel_format', 'rgba',
				'-video_size', `${width}x${height}`,
				'-framerate', '1',
				'-i', inputName,
			]);
			const exitCode = await runtime.ffmpeg.exec([
				...inputArgs,
				'-filter_complex', graph,
				'-map', '[video_out]',
				'-frames:v', '1',
				'-c:v', 'rawvideo',
				'-pix_fmt', 'rgba',
				'-f', 'rawvideo',
				outputName,
			]);
			if (exitCode !== 0) {
				await new Promise((resolve) => setTimeout(resolve, 50));
				throw new Error(`${name}: FFmpeg exited with ${exitCode}: ${runtime.logs.slice(logOffset).join('\n')}`);
			}
			const exported = await runtime.ffmpeg.readFile(outputName);
			if (!(exported instanceof Uint8Array) || exported.length !== width * height * 4) {
				throw new Error(`FFmpeg returned ${exported?.length ?? 'no'} bytes; expected ${width * height * 4}.`);
			}
			return {
				previewBase64: bytesToBase64(preview),
				exportBase64: bytesToBase64(exported),
				letterboxMismatchedPixels,
			};
		} finally {
			for (const inputName of inputNames) {
				await runtime.ffmpeg.deleteFile(inputName).catch(() => undefined);
			}
			await runtime.ffmpeg.deleteFile(outputName).catch(() => undefined);
		}

		function flipRgbaRows(bytes, frameWidth, frameHeight) {
			const result = new Uint8Array(bytes.length);
			const stride = frameWidth * 4;
			for (let y = 0; y < frameHeight; y += 1) {
				result.set(bytes.subarray((frameHeight - 1 - y) * stride, (frameHeight - y) * stride), y * stride);
			}
			return result;
		}

		function boxResampleRgba(bytes, sourceWidth, sourceX, sourceY, sourceWidthInPixels, sourceHeightInPixels, targetWidth, targetHeight) {
			if (sourceWidthInPixels === targetWidth && sourceHeightInPixels === targetHeight) {
				const result = new Uint8Array(targetWidth * targetHeight * 4);
				for (let y = 0; y < targetHeight; y += 1) {
					const start = ((sourceY + y) * sourceWidth + sourceX) * 4;
					result.set(bytes.subarray(start, start + targetWidth * 4), y * targetWidth * 4);
				}
				return result;
			}
			const result = new Uint8Array(targetWidth * targetHeight * 4);
			for (let targetY = 0; targetY < targetHeight; targetY += 1) {
				const firstY = sourceY + Math.floor(targetY * sourceHeightInPixels / targetHeight);
				const lastY = sourceY + Math.ceil((targetY + 1) * sourceHeightInPixels / targetHeight);
				for (let targetX = 0; targetX < targetWidth; targetX += 1) {
					const firstX = sourceX + Math.floor(targetX * sourceWidthInPixels / targetWidth);
					const lastX = sourceX + Math.ceil((targetX + 1) * sourceWidthInPixels / targetWidth);
					const sums = [0, 0, 0, 0];
					let sampleCount = 0;
					for (let sourcePixelY = firstY; sourcePixelY < lastY; sourcePixelY += 1) {
						for (let sourcePixelX = firstX; sourcePixelX < lastX; sourcePixelX += 1) {
							const sourceOffset = (sourcePixelY * sourceWidth + sourcePixelX) * 4;
							for (let channel = 0; channel < 4; channel += 1) {
								sums[channel] += bytes[sourceOffset + channel];
							}
							sampleCount += 1;
						}
					}
					const targetOffset = (targetY * targetWidth + targetX) * 4;
					for (let channel = 0; channel < 4; channel += 1) {
						result[targetOffset + channel] = Math.round(sums[channel] / sampleCount);
					}
				}
			}
			return result;
		}

		function bytesToBase64(bytes) {
			let binary = '';
			const chunkSize = 0x4000;
			for (let offset = 0; offset < bytes.length; offset += chunkSize) {
				binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
			}
			return btoa(binary);
		}
	}, parity);
}
