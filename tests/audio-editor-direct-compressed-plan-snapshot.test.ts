/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	captureCanonicalCompressedPlanCore,
	captureDirectCompressedContract,
	type DirectCompressedFormat,
	type DirectCompressedPlan,
} from '../src/common/editor/controller/export/internal/direct/direct-compressed-plan.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { normalizeMediaChannelMapping } from '../src/common/editor/media-export.js';

const FORMAT_CASES: readonly Readonly<{
	format: DirectCompressedFormat;
	options: Readonly<Record<string, unknown>>;
}>[] = Object.freeze([
	{ format: 'mp3', options: { bitRate: 320 } },
	{ format: 'flac', options: { sampleFormat: 'int16', compressionLevel: 8 } },
	{ format: 'ogg-vorbis', options: { quality: -1 } },
	{ format: 'opus', options: { bitRate: 320 } },
	{ format: 'wavpack', options: { sampleFormat: 'float32', compressionLevel: 5 } },
	{ format: 'mp2', options: { bitRate: 384 } },
	{ format: 'aac-m4a', options: { bitRate: 320 } },
]);

test('owned compressed snapshots preserve all seven actual direct mix contracts', () => {
	for (const entry of FORMAT_CASES) {
		for (const livePcmBytes of [2 * 1024 ** 3, 0]) {
			const plan = actualPlan(entry.format, { ...entry.options, livePcmBytes });
			const core = captureCanonicalCompressedPlanCore(plan);
			const contract = captureDirectCompressedContract(plan);
			assert.ok(core, `${entry.format}:${String(livePcmBytes)}`);
			assert.ok(contract, `${entry.format}:${String(livePcmBytes)}`);
			assert.equal(core.fingerprint.length > 0, true);
			assert.equal(contract.fingerprint.length > 0, true);
		}
	}
});



test('owned direct fingerprints change for canonical execution-field mutations', () => {
	const base = mutablePlan(actualPlan('mp3', { bitRate: 192 }));
	const initial = captureDirectCompressedContract(base);
	assert.ok(initial);
	const normalizeMapping = normalizeMediaChannelMapping as unknown as (
		inputChannelCount: number,
		value: unknown,
	) => Record<string, unknown>;
	const cases: readonly DirectCompressedPlan[] = [
		changedPlan(base, 'bitrate', (plan) => { record(plan.encoding).bitRate = 320; }).plan,
		changedPlan(base, 'mapping', (plan) => {
			const mapping = structuredClone(normalizeMapping(2, { channels: [1, 0] }));
			plan.channelMapping = mapping;
			record(plan.encoding).channelMapping = mapping;
		}).plan,
		changedPlan(base, 'metadata', (plan) => {
			plan.metadata = { artist: 'Changed', title: 'mp3' };
			record(plan.encoding).metadata = plan.metadata;
		}).plan,
		changedPlan(base, 'range', (plan) => {
			record(plan.range).startFrame = 10;
			record(plan.range).endFrame = 11;
		}).plan,
		changedPlan(base, 'render geometry', (plan) => {
			record(plan.render).livePcmBytes = 2 * 1024 ** 3 + 1;
			record(plan.render).totalBytes = 2 * 1024 ** 3 + 9;
		}).plan,
		changedPlan(base, 'output filename', (plan) => {
			records(plan.outputs)[0]!.fileName = 'changed.mp3';
		}).plan,
	];

	for (const plan of cases) {
		const current = captureDirectCompressedContract(plan);
		assert.ok(current);
		assert.notEqual(current.fingerprint, initial.fingerprint);
	}
});


test('offline admission drift changes or invalidates the owned compressed fingerprint', () => {
	const plan = mutablePlan(actualPlan('opus', { bitRate: 160, livePcmBytes: 0 }));
	const initial = captureDirectCompressedContract(plan);
	assert.ok(initial);
	const admission = record(record(plan.render).offlineRenderAdmission);
	admission.peakUsefulBinaryBytes = Number(admission.peakUsefulBinaryBytes) + 1;
	assert.equal(captureDirectCompressedContract(plan), null);
});

test('realtime offline-memory refusal is exact and its threshold cause cannot be forged', () => {
	const plan = mutablePlan(actualPlan(
		'mp3', { bitRate: 320, livePcmBytes: 0 }, 33_685_504,
	));
	const render = record(plan.render);
	assert.equal(render.strategy, 'realtime-stream');
	assert.equal(render.reason, 'offline-render-output-memory');
	assert.ok(captureDirectCompressedContract(plan));

	const peakDrift = mutablePlan(plan);
	const refusal = record(record(peakDrift.render).offlineRenderAdmission);
	refusal.peakUsefulBinaryBytes = Number(refusal.peakUsefulBinaryBytes) + 1;
	assert.equal(captureDirectCompressedContract(peakDrift), null);

	const causeDrift = mutablePlan(plan);
	const causeRender = record(causeDrift.render);
	causeRender.reason = 'output-memory';
	delete causeRender.offlineRenderAdmission;
	assert.equal(captureDirectCompressedContract(causeDrift), null);
});

function actualPlan(
	format: string,
	options: Readonly<Record<string, unknown>> = {},
	durationFrames = 1,
): DirectCompressedPlan {
	return createExportPlan(projectFixture(durationFrames), {
		mode: 'mix', format, includeTail: false, livePcmBytes: 2 * 1024 ** 3,
		metadata: { artist: 'Codex', title: format }, date: '2026-08-02', ...options,
	}) as unknown as DirectCompressedPlan;
}

function mutablePlan(plan: DirectCompressedPlan): DirectCompressedPlan {
	return structuredClone(plan) as DirectCompressedPlan;
}

function changedPlan(
	base: DirectCompressedPlan,
	label: string,
	change: (plan: Record<string | symbol, unknown>) => void,
): Readonly<{ label: string; plan: DirectCompressedPlan }> {
	const plan = structuredClone(base) as Record<string | symbol, unknown>;
	change(plan);
	return { label, plan: plan as DirectCompressedPlan };
}

function record(value: unknown): Record<string | symbol, unknown> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	return value as Record<string | symbol, unknown>;
}

function records(value: unknown): Record<string, unknown>[] {
	assert.ok(Array.isArray(value));
	return value as Record<string, unknown>[];
}

function projectFixture(durationFrames = 1) {
	return {
		schemaVersion: 9, id: 'compressed-snapshot-project', title: 'Session', revision: 1,
		createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
		sampleRate: 48_000, masterChannels: 2, metadata: {},
		selection: { startFrame: 0, endFrame: durationFrames },
		loop: { enabled: false, startFrame: 0, endFrame: durationFrames },
		sources: [{
			id: 'source', name: 'Source', storageKey: 'pcm/source', mimeType: 'audio/wav',
			frameCount: durationFrames, channelCount: 2, sampleRate: 48_000, sampleFormat: 'float32',
		}],
		clips: [{
			id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0,
			sourceStartFrame: 0, durationFrames,
		}],
		tracks: [{ id: 'track', type: 'audio', name: 'Track', clipIds: ['clip'], effectsActive: true, effects: [] }],
		mixer: { groups: [], sends: [], routes: {} }, master: { effectsActive: true, effects: [] },
	};
}
