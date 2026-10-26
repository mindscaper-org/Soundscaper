/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeClipNormalizationChannels } from '../src/common/editor/controller/clip-video/internal/clip-normalization-analysis.ts';
import { createClipPropertyService } from '../src/common/editor/controller/clip-video/internal/clip/clip-property-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { ENGLISH_COPY } from './helpers/audio-editor-multitrack-selection-harness.js';

for (const count of [1, 16, 32]) test(`peak normalization measures all ${count} channels without requiring a loudness window`, async () => {
	const channels = Array.from({ length: count }, () => new Float32Array(512).fill(.1));
	channels[count - 1]![511] = -.5; // The last channel and last sample own the normalization gain.
	const clip = { id: 'clip', sourceId: 'source', kind: 'audio' as const, timelineStartFrame: 0, sourceStartFrame: 0,
		sourceDurationFrames: 512, durationFrames: 512, gain: .1, pitchCents: 0, speedRatio: 1, renderCacheRevision: 0 };
	const project: ClipTransformProject = { id: `peak-${count}`, schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		title: 'Peak', sampleRate: 48_000, clips: [clip], tracks: [], sources: [{ id: 'source', channelCount: count, frameCount: 512, sampleRate: 48_000 }] };
	const generation = new EditorProjectGeneration(); generation.activate(project.id);
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const commits: AudioEditorCommand[] = [];
	const service = createClipPropertyService({ lifetime, copy: ENGLISH_COPY,
		sourceBuffers: new Map([['source', { length: 512, numberOfChannels: count, sampleRate: 48_000, getChannelData: index => channels[index]! }]]),
		getProject: () => project, getSelectedClipId: () => clip.id, editingBlocked: () => false,
		captureProject: () => generation.capture(), assertProject: token => generation.assertCurrent(token),
		analyzeChannels: (pcm, sampleRate, signal, peakOnly) => analyzeClipNormalizationChannels(pcm, sampleRate, ENGLISH_COPY, signal, peakOnly),
		createId: prefix => prefix, commit(command) { commits.push(command); },
	});
	await service.handleClipAction('normalize-peak');
	const command = commits[0]; assert.ok(command?.type === 'clip/update');
	assert.equal(command.changes.gain, 10 ** (-1 / 20) / .5);
});

test('programme loudness retains its channel admission and short-window semantics', async () => {
	const signal = new AbortController().signal;
	const result = await analyzeClipNormalizationChannels([new Float32Array(512).fill(.5)], 48_000, ENGLISH_COPY, signal, false);
	assert.equal(result.peakAmplitude, .5); assert.equal(result.integratedLufs, null);
	await assert.rejects(analyzeClipNormalizationChannels(Array.from({ length: 16 }, () => new Float32Array(512)),
		48_000, ENGLISH_COPY, signal, false), /Analysis channel count/u);
});

test('a retired peak measurement cannot commit a late partial batch', async () => {
	const abort = new AbortController(); abort.abort();
	await assert.rejects(analyzeClipNormalizationChannels(Array.from({ length: 16 }, () => new Float32Array(512)),
		48_000, ENGLISH_COPY, abort.signal, true), { name: 'AbortError' });
});
