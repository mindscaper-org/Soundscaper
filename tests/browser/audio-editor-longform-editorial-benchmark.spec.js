import { createHash } from 'node:crypto';

import { expect, test } from './helpers/nightly-packaged-electron.js';
import { packagedRuntimeEnvironmentFingerprint } from './helpers/packaged-runtime-environment.js';

import {
	M3_LONGFORM_EDITORIAL_FIXTURE_ID,
	M3_LONGFORM_EDITORIAL_PROFILE,
	M3_LONGFORM_EDITORIAL_SPECIFICATION,
	M3_LONGFORM_EDITORIAL_WORKLOAD_ID,
	createM3LongformEditorialWorkload,
} from '../../src/common/editor/quality/m3-longform-editorial-workload.ts';
import {
	bootEditor,
	waitForProjectActivation,
} from './audio-editor-test-helpers.js';
import { deterministicAvMedia, deterministicSilentVideoMedia } from './fixtures/deterministic-av-media.js';
import { waveformPeakBlockSizes, WAVEFORM_PEAKS_VERSION } from '../../src/common/editor/waveform-peak-contract.ts';
import { WAVEFORM_PEAK_CACHE_PREFIX } from '../../src/common/editor/source-analysis-cache.ts';
import { collectDecodedAvDriftSamples } from './helpers/decoded-av-drift-probe.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import {
	armInteractionToAttributeLatencyProbe,
	readInteractionToAttributeLatencyProbe,
} from './helpers/interaction-to-attribute-latency.js';

const DATABASE_NAME = SOUNDSCAPER_DATABASE_NAME;
const LOCAL_ENVIRONMENT_ID = 'local-runtime-diagnostics';
const HOSTED_ENVIRONMENT_ID = 'github-ubuntu-playwright-1.62.1';
const ENVIRONMENT_ID = process.env.SOUNDSCAPER_M3_OBSERVED_ENVIRONMENT_ID
	|| (process.env.GITHUB_ACTIONS === 'true' ? HOSTED_ENVIRONMENT_ID : LOCAL_ENVIRONMENT_ID);
const SAMPLE_RATE = 48_000;
const VIDEO_FRAME_SAMPLES = 1_600;
const PIXELS_PER_SECOND = 120;
const CLIP_CONTENT_OFFSET = 12;

test('collects the opt-in two-hour editorial diagnostic without qualifying the host', async ({
	page,
	context,
	runtimeBrowser,
}) => {
	test.skip(
		process.env.SOUNDSCAPER_M3_LONGFORM_BENCHMARK !== '1',
		'Run explicitly through quality:collect:m3-longform.',
	);
	test.setTimeout(360_000);
	await page.setViewportSize({ width: 1_440, height: 900 });
	const workload = createM3LongformEditorialWorkload();
	const expectedPositions = workload.editPlan.expectedClipPositions;
	const fixture = fixtureIdentity(workload);

	await bootEditor(page, '/embed/en/');
	if (process.env.SOUNDSCAPER_PACKAGED_RUNTIME_METRICS === '1') {
		expect(page.url()).toMatch(/^http:\/\/127\.0\.0\.1:/u);
	}
	await seedProject(page, workload.project);
	await page.reload();
	const editor = await waitForSeededEditor(page);
	await expect(editor.locator('.application-header__windows-title'))
		.toContainText('Milestone 3 two-hour editorial workload');
	await expect(editor).toHaveAttribute('data-track-count', '26');

	const positionChecks = await persistedPositionChecks(page, expectedPositions);
	expect(positionChecks).toHaveLength(26);
	expect(positionChecks.every(({ audioPositionErrorSamples }) => audioPositionErrorSamples === 0)).toBe(true);
	expect(positionChecks.every(({ videoPositionErrorFrames }) => videoPositionErrorFrames === 0)).toBe(true);

	const timeline = editor.locator('[data-timeline]');
	const ruler = editor.locator('[data-ruler]');
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await expect(ruler).toBeVisible();

	await seekOnTimeline(page, timeline, ruler, playhead, SAMPLE_RATE * 30);
	const cdp = await context.newCDPSession(page);
	await cdp.send('HeapProfiler.enable');
	const beforeBytes = await usedHeapAfterCollections(cdp, 3);
	const seekTrials = [];
	for (const checkpointSample of M3_LONGFORM_EDITORIAL_SPECIFICATION.seekCheckpointsSamples) {
		seekTrials.push(await seekOnTimeline(
			page,
			timeline,
			ruler,
			playhead,
			checkpointSample,
		));
	}
	const scrollFrameIntervalsMs = await measureTimelineScrollFrames(
		timeline,
		M3_LONGFORM_EDITORIAL_SPECIFICATION.scrollFrameIntervalSampleCount,
	);
	const afterBytes = await usedHeapAfterCollections(cdp, 3);
	const decodedAvSamples = await measureDecodedAvDrift(page);
	const renderer = await rendererDiagnostic(page);
	const environmentFingerprint = browserFingerprint(runtimeBrowser, renderer);

	const diagnostic = {
		schemaVersion: 1,
		profile: M3_LONGFORM_EDITORIAL_PROFILE,
		observationClass: 'decoded-media-av-scheduling-v1',
		workloadId: M3_LONGFORM_EDITORIAL_WORKLOAD_ID,
		fixtureId: M3_LONGFORM_EDITORIAL_FIXTURE_ID,
		environmentId: ENVIRONMENT_ID,
		rendererClass: renderer.rendererClass,
		environmentFingerprint,
		fixture,
		positionChecks,
		seekWarmupTrialCount: 1,
		seekTrials,
		decodedAvSamples,
		scrollFrameIntervalsMs,
		retainedHeap: {
			beforeBytes,
			afterBytes,
			forcedCollectionsBefore: 3,
			forcedCollectionsAfter: 3,
		},
	};
	console.log(`SOUNDSCAPER_M3_LONGFORM_EDITORIAL ${JSON.stringify(diagnostic)}`);
});

function fixtureIdentity(workload) {
	const specification = workload.specification;
	return {
		generatorRevision: specification.generatorRevision,
		seed: specification.seed,
		durationSeconds: specification.durationSeconds,
		sampleRate: specification.sampleRate,
		videoFrameRate: specification.videoFrameRate,
		audioTrackCount: specification.audioTrackCount,
		proxyVideoTrackCount: specification.proxyVideoTrackCount,
		editCount: specification.editCount,
		commandsPerTransaction: specification.commandsPerTransaction,
		operationCounts: specification.operationCounts,
		projectSha256: sha256(JSON.stringify(workload.project)),
		editPlanSha256: sha256(JSON.stringify(workload.editPlan.commands)),
	};
}

async function measureDecodedAvDrift(page) {
	const fixtures = deterministicAvMedia.map(({ id, file }) => ({
		id,
		mimeType: file.mimeType,
		base64: file.buffer.toString('base64'),
	}));
	return page.evaluate(collectDecodedAvDriftSamples, fixtures);
}

async function waitForSeededEditor(page) {
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible({ timeout: 20_000 });
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true', { timeout: 20_000 });
	await expect(editor).toHaveAttribute('data-project-id', M3_LONGFORM_EDITORIAL_FIXTURE_ID, { timeout: 30_000 });
	await waitForProjectActivation(editor);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
	return editor;
}

async function seedProject(page, project) {
	// Implicit silence blocks provide real readable two-hour PCM without retaining
	// two-hour arrays. Small video bodies support source activation only; decoded
	// A/V drift still uses the independent probe fixtures, not these timeline proxies.
	const video = deterministicSilentVideoMedia[0].file;
	const audio = project.sources.find((source) => source.kind === 'audio');
	await page.evaluate(async ({ databaseName, document, peakSizes, peakVersion, peakPrefix, videoBase64, videoMimeType }) => {
		const request = (value) => new Promise((resolve, reject) => {
			value.onsuccess = () => resolve(value.result);
			value.onerror = () => reject(value.error);
		});
		const database = await request(indexedDB.open(databaseName));
		try {
			const transaction = database.transaction(['projects', 'settings', 'sources', 'sourceChunks', 'analysis', 'mediaAssets'], 'readwrite');
			const completion = new Promise((resolve, reject) => {
				transaction.oncomplete = resolve;
				transaction.onerror = () => reject(transaction.error);
				transaction.onabort = () => reject(transaction.error);
			});
			transaction.objectStore('projects').put(document);
			const settings = transaction.objectStore('settings');
			settings.put({ key: 'soundscaper:last-project-id', value: document.id });
			settings.put({ key: 'last-project-id', value: document.id });
			settings.put({ key: 'soundscaper:audio-editor-recent-project-ids', value: [document.id] });
			settings.put({ key: 'soundscaper:timeline-ruler-playback', value: false });
			const sources = transaction.objectStore('sources');
			const poolId = `${document.id}:silence-pool`;
			const sourceToken = `${poolId}:pcm`;
			sources.put({ id: poolId, storage: 'indexeddb-chunks', sourceToken,
				sampleRate: document.sampleRate, channelCount: 1, frameCount: 1, frameLength: 1, chunkFrames: 65_536, chunkCount: 1 });
			transaction.objectStore('sourceChunks').put({ key: `${sourceToken}:0000000000`, sourceToken,
				index: 0, frames: 1, channels: [new Float32Array(1).buffer] });
			const videoBlob = new Blob([Uint8Array.from(atob(videoBase64), (character) => character.charCodeAt(0))], { type: videoMimeType });
			for (const source of document.sources) {
				if (source.kind === 'video') {
					transaction.objectStore('mediaAssets').put({ sourceId: source.storageKey, storage: 'indexeddb',
						blob: videoBlob, size: videoBlob.size, mimeType: videoMimeType });
					continue;
				}
				sources.put({ ...source, id: source.storageKey, storage: 'sample-block-sequence',
					sourceToken: `${source.id}:silence`, baseSourceId: poolId, frameLength: source.frameCount,
					chunkFrames: 65_536, chunkCount: Math.ceil(source.frameCount / 65_536),
					sampleBlockChannels: [[{ start: 0, frameCount: source.frameCount, poolStartFrame: null }]] });
				transaction.objectStore('analysis').put({ key: `${peakPrefix}${source.id}`, value: {
					version: peakVersion, channelCount: 1, levels: peakSizes.map((blockSize) => {
						const count = Math.ceil(source.frameCount / blockSize);
						return { blockSize, channels: [{ minimums: new Float32Array(count), maximums: new Float32Array(count), rms: new Float32Array(count) }] };
					}),
				} });
			}
			await completion;
		} finally {
			database.close();
		}
	}, { databaseName: DATABASE_NAME, document: project,
		peakSizes: waveformPeakBlockSizes(audio.frameCount, audio.channelCount), peakVersion: WAVEFORM_PEAKS_VERSION,
		peakPrefix: WAVEFORM_PEAK_CACHE_PREFIX, videoBase64: video.buffer.toString('base64'), videoMimeType: video.mimeType });
}

async function persistedPositionChecks(page, expectedPositions) {
	return page.evaluate(async ({ databaseName, fixtureId, expected, videoFrameSamples }) => {
		const request = (value) => new Promise((resolve, reject) => {
			value.onsuccess = () => resolve(value.result);
			value.onerror = () => reject(value.error);
		});
		const database = await request(indexedDB.open(databaseName));
		try {
			const project = await request(
				database.transaction('projects', 'readonly').objectStore('projects').get(fixtureId),
			);
			if (!project) throw new Error(`Persisted long-form project ${fixtureId} was not found.`);
			const clipById = new Map(project.clips.map((clip) => [clip.id, clip]));
			return expected.map((position) => {
				const clip = clipById.get(position.clipId);
				if (!clip) throw new Error(`Persisted long-form clip ${position.clipId} was not found.`);
				const observedTimelineSample = position.kind === 'video'
					? clip.sequenceStartFrame * videoFrameSamples
					: clip.timelineStartFrame;
				const observedVideoFrame = position.kind === 'video' ? clip.sequenceStartFrame : null;
				return {
					clipId: position.clipId,
					kind: position.kind,
					audioPositionErrorSamples: Math.abs(observedTimelineSample - position.timelineSample),
					videoPositionErrorFrames: position.videoFrame === null
						? 0
						: Math.abs(observedVideoFrame - position.videoFrame),
				};
			});
		} finally {
			database.close();
		}
	}, {
		databaseName: DATABASE_NAME,
		fixtureId: M3_LONGFORM_EDITORIAL_FIXTURE_ID,
		expected: expectedPositions,
		videoFrameSamples: VIDEO_FRAME_SAMPLES,
	});
}

async function seekOnTimeline(page, timeline, ruler, playhead, checkpointSample) {
	if (checkpointSample === 0) {
		await playhead.focus();
		const elapsedMs = await measureInteractionToPlayheadState({
			page,
			actionTarget: playhead,
			playhead,
			eventType: 'keydown',
			expectedValue: '0',
			action: () => page.keyboard.press('Home'),
		});
		return { checkpointSample, observedAudioSample: 0, observedVideoFrame: 0, elapsedMs };
	}
	const clickX = await timeline.evaluate((element, options) => new Promise((resolve) => {
		const targetPixel = options.checkpointSample / options.sampleRate * options.pixelsPerSecond;
		const maximumScroll = element.scrollWidth - element.clientWidth;
		element.scrollLeft = Math.min(maximumScroll, Math.max(0, targetPixel - 100));
		requestAnimationFrame(() => resolve(
			options.contentOffset + targetPixel - element.scrollLeft,
		));
	}), {
		checkpointSample,
		sampleRate: SAMPLE_RATE,
		pixelsPerSecond: PIXELS_PER_SECOND,
		contentOffset: CLIP_CONTENT_OFFSET,
	});
	const expectedValue = String(checkpointSample);
	const elapsedMs = await measureInteractionToPlayheadState({
		page,
		actionTarget: ruler,
		playhead,
		// The timeline commits this click from a window-capture pointerup handler;
		// arm at interaction onset so the renderer clock always precedes that commit.
		eventType: 'pointerdown',
		expectedValue,
		action: () => ruler.click({ position: { x: clickX, y: 28 } }),
	});
	const observedAudioSample = Number(await playhead.getAttribute('aria-valuenow'));
	return {
		checkpointSample,
		observedAudioSample,
		observedVideoFrame: observedAudioSample / VIDEO_FRAME_SAMPLES,
		elapsedMs,
	};
}

async function measureInteractionToPlayheadState({
	page,
	actionTarget,
	playhead,
	eventType,
	expectedValue,
	action,
}) {
	const actionElement = await actionTarget.elementHandle();
	const playheadElement = await playhead.elementHandle();
	if (!actionElement || !playheadElement) {
		await actionElement?.dispose();
		await playheadElement?.dispose();
		throw new Error('The long-form seek latency targets are unavailable.');
	}
	try {
		const probeId = await page.evaluate(armInteractionToAttributeLatencyProbe, {
			actionTarget: actionElement,
			observedTarget: playheadElement,
			eventType,
			attributeName: 'aria-valuenow',
			expectedValue,
		});
		await action();
		const elapsedMs = await page.evaluate(readInteractionToAttributeLatencyProbe, {
			observedTarget: playheadElement,
			probeId,
			timeoutMs: 5_000,
		});
		await expect(playhead).toHaveAttribute('aria-valuenow', expectedValue);
		return elapsedMs;
	} finally {
		await actionElement.dispose();
		await playheadElement.dispose();
	}
}

async function measureTimelineScrollFrames(timeline, sampleCount) {
	return timeline.evaluate((element, expectedSamples) => new Promise((resolve, reject) => {
		const maximum = element.scrollWidth - element.clientWidth;
		if (!(maximum > 0)) {
			reject(new Error('Long-form timeline is not horizontally scrollable.'));
			return;
		}
		const frameTimes = [];
		const sample = (time) => {
			frameTimes.push(time);
			if (frameTimes.length === expectedSamples + 1) {
				resolve(frameTimes.slice(1).map((value, index) => value - frameTimes[index]));
				return;
			}
			element.scrollLeft = maximum * frameTimes.length / expectedSamples;
			requestAnimationFrame(sample);
		};
		element.scrollLeft = 0;
		requestAnimationFrame(sample);
	}), sampleCount);
}

async function usedHeapAfterCollections(cdp, collectionCount) {
	for (let index = 0; index < collectionCount; index += 1) {
		await cdp.send('HeapProfiler.collectGarbage');
	}
	return (await cdp.send('Runtime.getHeapUsage')).usedSize;
}

async function rendererDiagnostic(page) {
	return page.evaluate(() => {
		const canvas = document.createElement('canvas');
		const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
		const info = gl?.getExtension('WEBGL_debug_renderer_info');
		const vendor = gl
			? String(info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR))
			: 'unavailable';
		const renderer = gl
			? String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
			: 'unavailable';
		const joined = `${vendor} ${renderer}`;
		return {
			vendor,
			renderer,
			rendererClass: !gl
				? 'unknown'
				: /swiftshader|llvmpipe|software|offscreen/iu.test(joined) ? 'software' : 'hardware',
		};
	});
}

const browserFingerprint = packagedRuntimeEnvironmentFingerprint;

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}
