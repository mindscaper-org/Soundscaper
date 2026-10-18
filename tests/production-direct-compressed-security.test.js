/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const budgetsUrl = new URL('../config/quality-budgets.json', import.meta.url);

const FORMAT_CONTRACTS = Object.freeze([
	{ id: 'mp3', extension: '.mp3', mimeType: 'audio/mpeg', pickerMimeType: 'audio/mpeg' },
	{ id: 'flac', extension: '.flac', mimeType: 'audio/flac', pickerMimeType: 'audio/flac' },
	{ id: 'ogg-vorbis', extension: '.ogg', mimeType: 'audio/ogg; codecs=vorbis', pickerMimeType: 'audio/ogg' },
	{ id: 'opus', extension: '.opus', mimeType: 'audio/ogg; codecs=opus', pickerMimeType: 'audio/ogg' },
	{ id: 'wavpack', extension: '.wv', mimeType: 'audio/x-wavpack', pickerMimeType: 'audio/x-wavpack' },
	{ id: 'mp2', extension: '.mp2', mimeType: 'audio/mpeg', pickerMimeType: 'audio/mpeg' },
	{ id: 'aac-m4a', extension: '.m4a', mimeType: 'audio/mp4', pickerMimeType: 'audio/mp4' },
]);
const FORMAT_IDS = Object.freeze(FORMAT_CONTRACTS.map(({ id }) => id));

test('exact direct compressed publication has browser-native ownership and rollback controls', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const publication = findControl(
		matrix,
		'desktop-write-path-capabilities',
		'exact-direct-compressed-mix-save',
	);
	const rollback = findControl(
		matrix,
		'long-job-cancellation',
		'direct-compressed-mix-save-rollback',
	);

	for (const path of [
		'src/common/editor/browser-audio-codec-runtime.ts',
		'src/common/editor/browser-dedicated-audio-codec.ts',
		'src/common/editor/browser-dedicated-audio-output-validation.ts',
		'src/common/editor/browser-dedicated-audio-worker-client.ts',
		'src/common/editor/browser-webcodecs-aac.ts',
		'scripts/lib/browser-bundle-codec-audit.mjs',
		'tests/audio-editor-browser-audio-codec-runtime.test.ts',
		'tests/audio-editor-browser-dedicated-codec.test.ts',
		'tests/audio-editor-browser-webcodecs-aac.test.ts',
		'tests/browser-bundle-codec-audit.test.js',
	]) {
		assert.ok(publication.evidence.some((item) => item.path === path), path);
		await access(new URL(`../${path}`, import.meta.url));
	}
	for (const path of [
		'src/common/editor/browser-audio-codec-runtime.ts',
		'src/common/editor/browser-dedicated-audio-worker-client.ts',
		'src/common/editor/browser-webcodecs-aac.ts',
		'tests/audio-editor-browser-audio-codec-runtime.test.ts',
		'tests/audio-editor-browser-dedicated-codec.test.ts',
		'tests/audio-editor-browser-webcodecs-aac.test.ts',
	]) assert.ok(rollback.evidence.some((item) => item.path === path), path);

	assert.equal(publication.evidence.some(({ path }) => path === 'src/common/editor/ffmpeg.js'), false);
	assert.equal(
		publication.evidence.some(({ path }) => path === 'patches/npm/@ffmpeg+ffmpeg+0.12.15.patch'),
		false,
	);
});

test('the direct compressed fixture records both render strategies without memory or scale claims', async () => {
	const budgets = JSON.parse(await readFile(budgetsUrl, 'utf8'));
	const fixture = budgets.fixtures.find(({ id }) => id === 'm2-direct-compressed-output-v2');
	assert.ok(fixture);
	assert.equal(budgets.fixtures.some(({ id }) => id === 'm2-direct-realtime-compressed-output-v1'), false);
	assert.equal(budgets.fixtures.some(({ id }) => id === 'm2-direct-realtime-mp3-output-v1'), false);
	assert.equal(fixture.kind, 'deterministic-direct-compressed-node-transport-witness');
	assert.equal(fixture.specification.generatorRevision, 3);
	assert.deepEqual(fixture.specification.admittedModes, [
		'realtime-single-mix-canonical-compressed-audio',
		'centrally-admitted-offline-single-mix-canonical-compressed-audio',
	]);
	assert.deepEqual(fixture.specification.admittedRenderStrategies, ['realtime-stream', 'offline']);
	assert.deepEqual(fixture.specification.admittedFormats, FORMAT_IDS);
	assert.deepEqual(fixture.specification.admittedFormatContracts, FORMAT_CONTRACTS);
	assert.deepEqual(fixture.specification.serviceDirectFormats, FORMAT_IDS);
	assert.equal(fixture.specification.allFormatsRealtimeServiceDirectRouteVerified, true);
	assert.equal(fixture.specification.allFormatsOfflineServiceDirectRouteVerified, true);
	assert.equal(fixture.specification.centralOfflineAdmissionRecomputed, true);
	assert.equal(fixture.specification.offlineCentralUsefulBinaryAdmissionCeilingBytes, 256 * 1024 ** 2);
	assert.equal(fixture.specification.offlineInputWidthStagingVerified, true);
	assert.equal(fixture.specification.offlineResampleBeforeStagingVerified, true);
	assert.equal(fixture.specification.realtimeChannelMappingOwner, 'pre-staging-pcm-transform');
	assert.equal(fixture.specification.offlineChannelMappingOwner, 'ffmpeg');
	assert.equal(fixture.specification.channelMappingApplicationsPerRoute, 1);
	assert.equal(fixture.specification.ordinaryOfflineRendererFailureReusesUnopenedDestination, true);
	assert.equal(fixture.specification.directOfflinePostRenderRealtimeRetry, false);
	assert.equal(fixture.specification.privateRenderedFallbackDirectOfflineVerified, true);
	assert.equal(fixture.specification.flacIntegerStagingDitherOwnershipVerified, true);
	assert.equal(fixture.specification.wavpackIntegerAndFloatDitherOwnershipVerified, true);
	assert.equal(fixture.specification.otherCompressedFloatStagingVerified, true);
	assert.equal(fixture.specification.preparedDestinationMode, 'exact-size-stream');
	assert.equal(fixture.specification.stagingInputMode, 'WORKERFS-mounted-WAV-Blob');
	assert.equal(fixture.specification.codecOutputMode, 'worker-MEMFS');
	assert.equal(fixture.specification.maximumOutputRangeBytes, 1_048_576);
	assert.equal(fixture.specification.virtualTransportByteLength, 269_484_049);
	assert.equal(fixture.specification.virtualTransportChunkCount, 258);
	assert.equal(fixture.specification.maximumConcurrentRangeReads, 1);
	assert.equal(fixture.specification.maximumConcurrentSinkWrites, 1);
	assert.equal(fixture.specification.wholeOutputReadFileCalls, 0);
	assert.equal(fixture.specification.representativeMp3PlannerAdmissionFrames, 33_685_504);
	assert.equal(fixture.specification.representativeMp3PlannerAdmissionStagingBytes, 269_484_032);
	assert.equal(fixture.specification.representativeMp3PlannerAdmissionReason, 'offline-render-output-memory');
	assert.equal(fixture.specification.realtimeServiceStagingPreflightBytes, 8);
	assert.equal(fixture.specification.offlineServiceStagingPreflightBytes, 32);
	assert.equal(fixture.specification.offlineStagingPayloadIncludesWavFraming, false);
	assert.equal(fixture.specification.realtimeServiceEncodedOutputBytes, 5);
	assert.equal(fixture.specification.realtimeServiceEncodedOutputChunks, 2);
	assert.equal(fixture.specification.offlineServiceEncodedOutputBytes, 5);
	assert.equal(fixture.specification.offlineServiceEncodedOutputChunks, 1);
	assert.equal(fixture.specification.destinationSelectedBeforeRender, true);
	assert.equal(fixture.specification.destinationOpenedAfterFfmpegStat, true);
	assert.equal(fixture.specification.preparedBlobFallbackRetained, true);
	assert.equal(fixture.specification.directRouteDownloadCalls, 0);
	assert.equal(fixture.specification.retainedFinalOutputBytes, 0);
	assert.equal(fixture.specification.partialPublishedOutputs, 0);
	assert.doesNotMatch(JSON.stringify(fixture.specification), /qualified/iu);
	const workload = budgets.workloads.find(({ id }) => id === 'm2-direct-compressed-output-v2');
	assert.deepEqual(workload.fixtureIds, ['m2-direct-compressed-output-v2']);
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
