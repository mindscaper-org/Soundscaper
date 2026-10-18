/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import { CANONICAL_VIDEO_EXPORT_PLAN_VERSION } from '../src/common/editor/video-export-plan-version.ts';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const budgetsUrl = new URL('../config/quality-budgets.json', import.meta.url);

const FORMAT_CONTRACTS = Object.freeze([
	{
		id: 'mp4', extension: '.mp4', mimeType: 'video/mp4', purpose: 'video',
		videoEncoder: 'libx264', audioEncoder: 'aac', pixelFormat: 'yuv420p', faststart: true,
	},
	{
		id: 'webm', extension: '.webm', mimeType: 'video/webm', purpose: 'video',
		videoEncoder: 'libvpx-vp9', audioEncoder: 'libopus', pixelFormat: 'yuv420p', faststart: false,
	},
]);

const PUBLICATION_EVIDENCE = Object.freeze([
	'src/common/editor/video-delivery-encoder-tier.ts',
	'src/common/editor/video-keyframe-video-encoder.ts',
	'src/common/editor/video-keyframe-mediabunny-execution.ts',
	'src/common/editor/video-mediabunny-muxer.ts',
	'src/common/editor/video-keyframe-video-output.ts',
	'src/common/editor/controller/export/internal/direct/direct-video-export.ts',
	'src/common/editor/controller/export/internal/video/video-export-service.ts',
	'src/common/editor/desktop-video-codec-runtime.ts',
	'desktop/external-ffmpeg-video-operation-service.ts',
	'desktop/external-ffmpeg-video-verification.ts',
	'desktop/external-ffmpeg-video-canary-inspection.ts',
	'tests/audio-editor-video-delivery-encoder-tier.test.ts',
	'tests/audio-editor-video-keyframe-mediabunny-execution.test.ts',
	'tests/audio-editor-video-mediabunny-muxer.test.ts',
	'tests/audio-editor-export-direct-video.test.ts',
	'tests/external-ffmpeg-video-operation-service.test.ts',
	'tests/external-ffmpeg-video-verification.test.ts',
	'tests/external-ffmpeg-video-canary-inspection.test.ts',
]);

const ROLLBACK_EVIDENCE = Object.freeze([
	'src/common/editor/video-delivery-encoder-tier.ts',
	'src/common/editor/video-keyframe-video-encoder.ts',
	'src/common/editor/video-keyframe-mediabunny-execution.ts',
	'src/common/editor/video-mediabunny-muxer.ts',
	'src/common/editor/controller/export/internal/direct/direct-video-export.ts',
	'src/common/editor/controller/export/internal/video/video-export-service.ts',
	'src/common/editor/desktop-video-codec-runtime.ts',
	'desktop/external-ffmpeg-video-session-cleanup.ts',
	'tests/audio-editor-video-keyframe-native-video-encoder.test.ts',
	'tests/audio-editor-video-keyframe-mediabunny-execution.test.ts',
	'tests/audio-editor-video-mediabunny-muxer.test.ts',
	'tests/audio-editor-export-direct-video.test.ts',
	'tests/external-ffmpeg-video-session-cleanup.test.ts',
]);

const KEYED_PROJECT_EVIDENCE = Object.freeze([
	'src/common/editor/project-schema-identity.ts',
	'src/framescaper/editor-project-identity.ts',
	'src/framescaper/editor-project.ts',
	'tests/audio-editor-project-schema-identity.test.ts',
	'tests/audio-editor-framescaper-baseline.test.ts',
]);

const KEYED_EXPORT_AUTHORITY_EVIDENCE = Object.freeze([
	'src/framescaper/editor-project-unified-render-authority.ts',
	'src/framescaper/editor-project.ts',
	'src/framescaper/video-export-dispatch-retime.ts',
	'tests/audio-editor-framescaper-baseline.test.ts',
]);

const KEYED_ENCODER_EVIDENCE = Object.freeze([
	'src/common/editor/video-keyframe-encoder-admission.ts',
	'src/common/editor/video-keyframe-audio-input.ts',
	'src/common/editor/video-webcodecs-producer.ts',
	'src/common/editor/video-keyframe-video-encoder.ts',
	'src/common/editor/video-keyframe-mediabunny-execution.ts',
	'src/common/editor/video-mediabunny-muxer.ts',
	'src/common/editor/desktop-video-codec-runtime.ts',
	'desktop/external-ffmpeg-video-operation-service.ts',
	'desktop/external-ffmpeg-video-session-cleanup.ts',
	'tests/audio-editor-video-webcodecs-producer.test.ts',
	'tests/audio-editor-video-keyframe-native-video-encoder.test.ts',
	'tests/audio-editor-video-keyframe-mediabunny-execution.test.ts',
	'tests/audio-editor-video-mediabunny-muxer.test.ts',
	'tests/audio-editor-desktop-video-codec-runtime.test.ts',
	'tests/external-ffmpeg-video-session-cleanup.test.ts',
]);

test('exact direct MP4 and WebM publication admits shared WebCodecs before verified desktop fallback', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const publication = findControl(
		matrix,
		'desktop-write-path-capabilities',
		'exact-direct-mp4-webm-video-save',
	);
	const rollback = findControl(
		matrix,
		'long-job-cancellation',
		'direct-mp4-webm-video-save-rollback',
	);
	findControl(
		matrix,
		'external-project-document-validation',
		'video-rendered-fallback-export',
	);

	for (const path of PUBLICATION_EVIDENCE) {
		assert.ok(publication.evidence.some((item) => item.path === path), path);
		await access(new URL(`../${path}`, import.meta.url));
	}
	for (const path of ROLLBACK_EVIDENCE) {
		assert.ok(rollback.evidence.some((item) => item.path === path), path);
	}
	assert.equal(publication.evidence.some(({ path }) => path === 'src/common/editor/ffmpeg.js'), false);
	assert.equal(
		publication.evidence.some(({ path }) => path === 'patches/npm/@ffmpeg+ffmpeg+0.12.15.patch'),
		false,
	);
});

test('Framescaper family-v1 admission and encoding reuse the existing video publication authority', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const project = findControl(
		matrix,
		'external-project-document-validation',
		'framescaper-v1-keyed-project-admission',
	);
	const authority = findControl(
		matrix,
		'external-project-document-validation',
		'framescaper-v1-keyed-export-authority',
	);
	const encoder = findControl(
		matrix,
		'long-job-cancellation',
		'bounded-keyed-rgba-av-encoding',
	);
	const publication = findControl(
		matrix,
		'desktop-write-path-capabilities',
		'exact-direct-mp4-webm-video-save',
	);
	const rollback = findControl(
		matrix,
		'long-job-cancellation',
		'direct-mp4-webm-video-save-rollback',
	);

	for (const [control, paths] of [
		[project, KEYED_PROJECT_EVIDENCE],
		[authority, KEYED_EXPORT_AUTHORITY_EVIDENCE],
		[encoder, KEYED_ENCODER_EVIDENCE],
	]) {
		for (const path of paths) {
			assert.ok(control.evidence.some((item) => item.path === path), path);
			await access(new URL(`../${path}`, import.meta.url));
		}
	}
	for (const path of [
		'src/common/editor/video-keyframe-video-encoder.ts',
		'src/common/editor/video-keyframe-mediabunny-execution.ts',
		'src/common/editor/video-mediabunny-muxer.ts',
		'tests/audio-editor-video-keyframe-mediabunny-execution.test.ts',
		'tests/audio-editor-video-mediabunny-muxer.test.ts',
	]) {
		assert.ok(publication.evidence.some((item) => item.path === path), path);
		assert.ok(rollback.evidence.some((item) => item.path === path), path);
	}

	assert.deepEqual(
		matrix.publicationRouteVerification.routes
			.filter(({ id }) => id.startsWith('video-'))
			.map(({ id, controlId }) => [id, controlId]),
		[
			['video-browser-blob', 'bounded-browser-export-blob-publication'],
			['video-direct-mp4', 'exact-direct-mp4-webm-video-save'],
			['video-direct-webm', 'exact-direct-mp4-webm-video-save'],
		],
		'keyed V7 is a strategy within the three existing video publication routes',
	);
});

test('the direct video fixture records exact MP4 and WebM transport without codec, memory, or scale claims', async () => {
	const budgets = JSON.parse(await readFile(budgetsUrl, 'utf8'));
	const fixture = budgets.fixtures.find(({ id }) => id === 'm2-direct-mp4-webm-video-output-v1');
	assert.ok(fixture);
	assert.equal(fixture.kind, 'deterministic-direct-mp4-webm-node-transport-witness');
	assert.equal(fixture.specification.generatorRevision, 1);
	assert.equal(fixture.specification.admittedMode, 'canonical-mp4-webm-final-video');
	assert.equal(fixture.specification.planVersion, CANONICAL_VIDEO_EXPORT_PLAN_VERSION);
	assert.deepEqual(fixture.specification.admittedFormatContracts, FORMAT_CONTRACTS);
	assert.equal(fixture.specification.preparedDestinationMode, 'exact-size-stream');
	assert.equal(fixture.specification.sourceVideoInputMode, 'WORKERFS-mounted-video-Blobs');
	assert.equal(fixture.specification.optionalAudioInputMode, 'WORKERFS-mounted-staged-WAV-Blob');
	assert.equal(fixture.specification.codecOutputMode, 'worker-MEMFS');
	assert.equal(fixture.specification.maximumOutputRangeBytes, 1_048_576);
	assert.equal(fixture.specification.transportBodyByteLength, 2_097_169);
	assert.equal(fixture.specification.transportChunkCount, 3);
	assert.deepEqual(fixture.specification.transportChunkByteLengths, [1_048_576, 1_048_576, 17]);
	assert.equal(fixture.specification.ffmpegStatCalls, 1);
	assert.equal(fixture.specification.wholeOutputReadFileCalls, 0);
	assert.equal(fixture.specification.maximumConcurrentRangeReads, 1);
	assert.equal(fixture.specification.maximumConcurrentSinkWrites, 1);
	assert.equal(fixture.specification.renderedFallbackVerificationBeforePlanAndSelection, true);
	assert.equal(fixture.specification.browserTargetPreparedBeforePreflightAndInputs, true);
	assert.equal(fixture.specification.writerOpenedAfterFfmpegStat, true);
	assert.equal(fixture.specification.desktopTargetPreparedInsideSinkOpen, true);
	assert.equal(fixture.specification.desktopSaveTargetTtlMilliseconds, 900_000);
	assert.equal(fixture.specification.closeBeforeCommitVerified, true);
	assert.equal(fixture.specification.preparedBlobFallbackRetained, true);
	assert.equal(fixture.specification.directFinalBlobCreated, false);
	assert.equal(fixture.specification.directObjectUrlCalls, 0);
	assert.equal(fixture.specification.directDownloadCalls, 0);
	assert.equal(fixture.specification.retainedFinalOutputBytes, 0);
	assert.equal(fixture.specification.partialPublishedOutputs, 0);
	for (const field of [
		'workerMemfsQualified',
		'sourceVideoBlobResidencyQualified',
		'stagedAudioBlobResidencyQualified',
		'actualFfmpegCodecExecutionQualified',
		'codecConformanceQualified',
		'nativeWasmCodecMemoryQualified',
		'rendererHeapQualified',
		'garbageCollectionQualified',
		'processRssQualified',
		'cpuQualified',
		'elapsedTimeQualified',
		'browserQualified',
		'operatingSystemQualified',
		'nativePickerQualified',
		'packagedElectronQualified',
		'referenceScaleQualified',
		'quotaQualified',
		'filesystemDurabilityQualified',
		'crashPowerLossQualified',
	]) assert.equal(Object.hasOwn(fixture.specification, field), false, field);
	const workload = budgets.workloads.find(({ id }) => id === 'm2-direct-mp4-webm-video-output-v1');
	assert.deepEqual(workload.fixtureIds, ['m2-direct-mp4-webm-video-output-v1']);
	assert.equal(workload.behavior, 'blocking');
	assert.equal(budgets.workloads.some(({ id }) => id === 'm2-streaming-bounded-memory'), false);
});

function findControl(matrix, riskId, controlId) {
	const risk = matrix.risks.find(({ id }) => id === riskId);
	assert.ok(risk, riskId);
	const control = risk.currentControls.find(({ id }) => id === controlId);
	assert.ok(control, controlId);
	return control;
}
