/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffectMacroService } from '../src/common/editor/controller/effects/internal/macro/effect-macro-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { applyAudioSelectionEffectAsync } from '../src/common/editor/selection-effects.js';
import { createHarness, requireBatch } from './helpers/effect-result-service-fixture.ts';

for (const mode of ['independent', 'linked', 'disabled-independent'] as const) test(`${mode} truncation commits its selected silent lane and stereo result`, async () => {
	const rate = 8000, frames = rate * 2;
	const channels = [0.3, 0.7].map(start => {
		const channel = new Float32Array(frames).fill(.35); channel.fill(0, start * rate, (start + 1) * rate); return channel;
	});
	const authored = createAudioEditorProjectV17({ sampleRate: rate,
		sources: [createAudioSource({ id: 'source', frameCount: frames, sampleRate: rate, channelCount: 2 })],
		clips: [createAudioClip({ id: 'dialogue', sourceId: 'source', durationFrames: frames, sourceDurationFrames: frames })],
		tracks: [createAudioTrack({ id: 'blank' }, rate), createAudioTrack({ id: 'voice', clipIds: ['dialogue'] }, rate)],
	});
	const project = { ...authored, tracks: authored.tracks.map(track => ({ ...track })) };
	const targets = project.tracks.map(track => ({ track, startFrame: 0, endFrame: frames, durationFrames: frames,
		channelCount: track.id === 'voice' ? 2 : 1, hasAudio: track.id === 'voice' }));
	const persisted = createHarness({ runtime: { getProject: () => project, projectSampleRate: () => rate } });
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration(); projectGeneration.activate(project.id);
	const unavailable = (): never => assert.fail('Offline truncation does not require a rack');
	let independentPermission = false;
	const macro = createEffectMacroService({ lifetime, projectGeneration, memoryLimitBytes: 64 * 1024 ** 2,
		copy: { audioTrackNotFound: 'Missing', audacityApplied: 'Applied', audacityProcessing: 'Processing',
			audacitySelectionHint: 'Select audio', autoDuckControlTrack: 'Select control', effectInvalidAudio: 'Invalid',
			effectRackEmpty: 'Empty', noiseProfileMissing: 'Profile required', macrosPalette: 'Macros', untitledMacro: 'Macro' },
		getProject: () => project, audacityEffectTarget: () => targets[0]!, audacityEffectTargets: () => targets,
		editingBlocked: () => false, materializeRackEffect: unavailable, projectSampleRate: () => rate,
		projectFrameCount: () => frames, effectRackLatencyFrames: () => 0, isAudacityRackEffectType: () => false,
		estimateAudacityEffectPeakBytes: () => 0, audacityEffectMemoryError: () => new Error('Too large'),
		setProcessing() {}, setStatus() {}, publishDocumentSnapshot() {}, handleError(error) { throw error; },
		preflightStorage: async () => undefined, cloneProject: value => structuredClone(value),
		renderDryTrackRange: async id => id === 'voice' ? channels.map(channel => channel.slice()) : [new Float32Array(frames)],
		runSelectionEffectWorker: async request => ({ channels: await applyAudioSelectionEffectAsync(request.effectType,
			[...request.channels], request.sampleRate, request.params, request.context) as Float32Array[] }),
		createAudioBuffer: unavailable, renderSnapshot: unavailable, renderStagedSnapshot: unavailable,
		audioBufferChannels: unavailable, matchAudacitySelectionChannels: values => [...values],
		persistAudacityEffectResult: async () => assert.fail('Both selected lanes belong to one result batch'),
		persistAudacityEffectResults: async (results, type, options) => {
			independentPermission = options?.allowIndependentLengths === true;
			await persisted.service.persistAudacityEffectResults(results, type, options);
		},
	});
	try {
		assert.equal(await macro.runEffectMacro({ effects: [
			...(mode === 'disabled-independent' ? [{ type: 'audacity-truncate-silence', enabled: false, params: { independent: true } }] : []),
			{ type: 'audacity-truncate-silence', params: { independent: mode === 'independent', minimumSilence: .5, truncateTo: 0 } },
		] }), true);
		assert.equal(independentPermission, mode === 'independent');
		assert.equal(persisted.events.sourcesOpened.length, 1, 'the empty selected lane remains empty');
		assert.equal(persisted.events.rangeReplacements[0]?.source?.channelCount, 2);
		assert.equal(persisted.events.rangeReplacements[0]?.source?.frameCount, 1.4 * rate);
		assert.equal(persisted.events.commits.length, 1);
		assert.equal(requireBatch(persisted.events.commits[0]!.command).commands.at(-1)?.type, 'selection/set');
	} finally { lifetime.beginDisposal(); lifetime.finishDisposal(); }
});
