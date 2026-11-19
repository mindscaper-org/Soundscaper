/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
	computeAudioTrackFreezeDigestsV1,
	normalizeAudioTrackFreezeV1,
	type AudioTrackFreezeDigestsV1,
	type AudioTrackFreezeV1,
} from '../src/common/editor/audio-track-freeze-v21.ts';
import { projectFeatureAudioRenderedFallbackPlayback } from '../src/common/editor/project-feature-audio-rendered-fallback.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { evaluateProjectFeatureRequirements } from '../src/common/editor/project-feature-requirements.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { compactProjectSourceMetadata } from '../src/common/editor/retention.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { createSoundscaperAudioTrackFreezePlaybackService } from '../src/soundscaper/editor-audio-track-freeze-playback.ts';
import {
	soundscaperAudioTrackFreezeRequirementId,
} from '../src/soundscaper/editor-project-feature-requirements.ts';
import { createSoundscaperPlaybackProjectService } from '../src/soundscaper/editor-project-playback.ts';
import {
	cloneSoundscaperProject,
	createSoundscaperProject,
	loadSoundscaperProject,
} from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';

const NOW = '2026-08-14T12:00:00.000Z';
const DERIVED_DIGEST = 'c3'.repeat(32);
const LIVE_DIGEST = 'd4'.repeat(32);

test('V21 persists one exact optional freeze and owns its per-track rendered fallback', () => {
	const project = frozenProject();
	const track = project.tracks.find(({ id }) => id === 'voice') as Readonly<Record<string, unknown>>;
	const freeze = normalizeAudioTrackFreezeV1(track.audioFreeze);
	assert.ok(Object.isFrozen(freeze));
	assert.equal(freeze.derivedSourceId, 'voice-freeze');
	const requirements = project.featureRequirements.requirements.filter(({ featureId }) => (
		featureId === PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze
	));
	assert.deepEqual(requirements, [{
		id: soundscaperAudioTrackFreezeRequirementId('voice'),
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze,
		displayName: 'Frozen audio track',
		disposition: 'rendered-fallback',
		fallback: {
			role: 'audio-track-render-v1', kind: 'audio', sourceId: 'voice-freeze',
			sha256: DERIVED_DIGEST, targetTrackId: 'voice',
		},
	}]);
	assert.equal(validateSoundscaperProject(project), true);
	assert.deepEqual(
		(compactProjectSourceMetadata(project).sources as readonly Readonly<{ id: string }>[])
			.map(({ id }) => id),
		['voice-source', 'voice-freeze'],
	);
	assert.doesNotMatch(
		JSON.stringify(project),
		/"(?:pcm|base64|channelData|audioBuffer|payload|chunks|bytes|blob|data)":/u,
	);

	const cloned = cloneSoundscaperProject(project);
	const loaded = loadSoundscaperProject(structuredClone(project));
	assert.deepEqual(cloned, project);
	assert.deepEqual(loaded.project, project);
	assert.notStrictEqual(cloned, project);
	assert.ok(Object.isFrozen(normalizeAudioTrackFreezeV1(
		(cloned.tracks.find(({ id }) => id === 'voice') as Readonly<Record<string, unknown>>).audioFreeze,
	)));
});

test('V21 freeze validation rejects wrong owners, missing identity, geometry drift, and document media bodies', () => {
	const project = frozenProject();
	const cases: ReadonlyArray<readonly [
		(project: Record<string, unknown>) => void,
		RegExp,
	]> = [
		[(candidate) => {
			const track = trackRecord(candidate);
			track.audioFreeze = { ...track.audioFreeze as object, extra: true };
		}, /unsupported field|freeze/iu],
		[(candidate) => {
			const source = sourceRecord(candidate, 'voice-freeze');
			delete source.contentSha256;
		}, /contentSha256|digest/iu],
		[(candidate) => {
			const source = sourceRecord(candidate, 'voice-freeze');
			source.frameCount = 999;
		}, /frameCount|geometry|render range/iu],
		[(candidate) => {
			const source = sourceRecord(candidate, 'voice-freeze');
			source.opaqueExtensions = { payload: 'AAAA' };
		}, /PCM|payload|media bod/iu],
		[(candidate) => {
			const track = trackRecord(candidate);
			track.type = 'video';
		}, /track|audioFreeze|video/iu],
	];
	for (const [mutate, message] of cases) {
		const candidate = structuredClone(project) as unknown as Record<string, unknown>;
		mutate(candidate);
		assert.throws(() => validateSoundscaperProject(candidate), message);
	}
});

test('an unavailable audio-track-freeze capability projects only the derived frozen track render', () => {
	const project = frozenProject();
	const known = new Set(Object.values(PROJECT_FEATURE_CAPABILITY_IDS));
	const available = new Set(known);
	available.delete(PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze);
	const report = evaluateProjectFeatureRequirements(project.featureRequirements, {
		knownFeatureIds: known,
		availableFeatureIds: available,
		sources: project.sources,
		clips: project.clips,
		tracks: project.tracks,
		schemaVersion: project.schemaVersion,
		sampleRate: project.sampleRate,
		sequences: project.sequences,
		primarySequenceId: project.primarySequenceId,
	});
	const freezeItem = report.items.find(({ featureId }) => (
		featureId === PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze
	));
	assert.equal(freezeItem?.availability, 'unavailable');
	assert.equal(freezeItem?.disposition, 'rendered-fallback');
	const projected = projectFeatureAudioRenderedFallbackPlayback(project, report);
	assert.equal(projected.metadata?.featureId, PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze);
	assert.equal(projected.metadata?.sourceId, 'voice-freeze');
	const playback = projected.project;
	const target = playback.tracks.find(({ id }) => id === 'voice') as Readonly<Record<string, unknown>>;
	assert.deepEqual(target.clipIds, ['soundscaper:rendered-audio-fallback:track-clip']);
	assert.deepEqual(target.effects, []);
	assert.equal(target.effectsActive, false);
	assert.equal(Object.hasOwn(target, 'audioFreeze'), false);
	const rendered = playback.clips.find(({ id }) => (
		id === 'soundscaper:rendered-audio-fallback:track-clip'
	)) as Readonly<Record<string, unknown>>;
	assert.equal(rendered.sourceId, 'voice-freeze');
	assert.equal(rendered.timelineStartFrame, 64);
	assert.equal(rendered.durationFrames, 1_024);
	assert.equal(rendered.anchor, 'sample');
	assert.deepEqual(playback.automationLanes, [project.automationLanes[1]]);
	assert.deepEqual(project.tracks.find(({ id }) => id === 'voice')?.clipIds, ['voice-clip']);
});

test('reopening a freeze authenticates legacy model PCM against its original WAV receipt', async () => {
	const { project, playback, store } = legacyModelFreezeFixture();
	const reopened = loadSoundscaperProject(structuredClone(project)).project;
	await playback.prepareProjectForActivation?.(reopened);
	assert.equal(playback.getFreezeStatus(reopened, 'voice'), 'fresh');
	assert.deepEqual(playback.projectForPlayback(reopened).requiredAudioSourceIds, ['voice-freeze']);
	assert.equal(store.sourceReads, 1);

	const withoutReceipt = structuredClone(reopened) as unknown as Record<string, unknown>;
	sourceRecord(withoutReceipt, 'voice-source').opaqueExtensions = {};
	await playback.prepareProjectForActivation?.(withoutReceipt);
	assert.equal(playback.getFreezeStatus(withoutReceipt, 'voice'), 'unknown');

	await playback.prepareProjectForActivation?.(reopened);
	assert.equal(playback.getFreezeStatus(reopened, 'voice'), 'fresh');
	store.liveChannels[0]![0] = 0.25;
	store.generation += 1;
	await playback.prepareProjectForActivation?.(reopened);
	assert.equal(playback.getFreezeStatus(reopened, 'voice'), 'unknown');
	assert.deepEqual(playback.projectForPlayback(reopened).requiredAudioSourceIds, []);
	playback.dispose();
});

test('legacy model PCM verification rejects replacement and cancellation during the source read', async () => {
	const { project, playback, store } = legacyModelFreezeFixture();
	store.afterLiveRead = () => { store.generation += 1; };
	await playback.prepareProjectForActivation?.(project);
	assert.equal(playback.getFreezeStatus(project, 'voice'), 'unknown');

	const abort = new AbortController();
	store.afterLiveRead = () => { abort.abort(new Error('cancel legacy source verification')); };
	await assert.rejects(playback.prepareProjectForActivation!(project, { signal: abort.signal }),
		/cancel legacy source verification/u);
	assert.equal(playback.getFreezeStatus(project, 'voice'), 'unknown');
	playback.dispose();
});

function legacyModelFreezeFixture() {
	const liveChannels = [new Float32Array(512).fill(0.125), new Float32Array(512).fill(-0.125)];
	const derivedChannels = [new Float32Array(1_024), new Float32Array(1_024)];
	const wave = encodeWav(liveChannels, { sampleRate: 48_000, bitDepth: 32, float: true, dither: false });
	const liveDigest = createHash('sha256').update(wave).digest('hex');
	const header = Buffer.alloc(4);
	header.writeUInt32LE(1_024);
	const derivedDigest = createHash('sha256').update(header).update(Buffer.alloc(1_024 * 2 * 4)).digest('hex');
	const project = frozenProject({
		contentSha256: liveDigest, mimeType: 'audio/wav', byteLength: wave.byteLength,
		opaqueExtensions: { 'org.soundscaper.local-assistance-audio-v1': {
			version: 1, operation: 'speech-enhancement', slotId: 'enhanced-audio',
			outputClaim: {
				claimVersion: 1, claimId: '1'.repeat(40), jobId: '2'.repeat(40),
				role: 'enhanced-audio', mediaType: 'audio/wav', sha256: liveDigest, byteLength: wave.byteLength,
			},
		} },
	}, derivedDigest);
	const store = {
		liveChannels,
		sourceReads: 0,
		generation: 1,
		afterLiveRead(): void { /* Most reads finish without intervention. */ },
		getSourceMetadata(id: string) {
			return {
				id, sourceToken: id === 'pcm:voice-source' ? String(store.generation) : 'rendered',
				frameCount: id === 'pcm:voice-source' ? 512 : 1_024, channelCount: 2,
				chunkFrames: 65_536, sampleRate: 48_000,
			};
		},
		async *readSourceChunks(id: string) {
			if (id === 'pcm:voice-source') {
				store.sourceReads += 1;
				yield liveChannels;
				store.afterLiveRead();
			} else yield derivedChannels;
		},
		openSourceReadSession: () => null,
	};
	const playback = createSoundscaperAudioTrackFreezePlaybackService(createSoundscaperPlaybackProjectService(), store);
	return { project, playback, store };
}

function frozenProject(
	liveSourceOptions: Readonly<Record<string, unknown>> = {},
	derivedDigest = DERIVED_DIGEST,
) {
	const liveSource = createAudioSource({
		id: 'voice-source', name: 'Voice source', storageKey: 'pcm:voice-source',
		contentSha256: LIVE_DIGEST,
		frameCount: 512, channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
		...liveSourceOptions,
	});
	const derivedSource = createAudioSource({
		id: 'voice-freeze', name: 'Voice freeze', storageKey: 'derived:voice-freeze',
		contentSha256: derivedDigest,
		frameCount: 1_024, channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const clip = createAudioClip({
		id: 'voice-clip', sourceId: 'voice-source', title: 'Voice',
		timelineStartFrame: 100, durationFrames: 512,
		sourceStartFrame: 0, sourceDurationFrames: 512,
	});
	const effect = {
		id: 'voice-fx', type: 'limiter', enabled: true,
		params: { ceiling: -1, lookahead: 0.005, release: 0.1 },
	};
	const automationEffect = {
		id: 'voice-filter', type: 'highpass', enabled: true,
		params: { frequency: 1_000, q: 1 },
	};
	const automationLanes = [
		{
			id: 'voice-effect-frequency',
			address: {
				kind: 'effect', strip: { kind: 'track', id: 'voice' },
				effectId: 'voice-filter', parameterId: 'frequency',
			},
			timebase: 'absolute-samples', points: [{ id: 'start', position: 0, value: 1_000 }], segments: [],
		},
		{
			id: 'voice-strip-gain',
			address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
			timebase: 'absolute-samples', points: [{ id: 'start', position: 0, value: 1 }], segments: [],
		},
	] as const;
	const editableTrack = createAudioTrack({
		id: 'voice', name: 'Voice', clipIds: ['voice-clip'],
		effects: [effect, automationEffect],
	});
	const digests = computeAudioTrackFreezeDigestsV1({
		sampleRate: 48_000,
		renderStartFrame: 64,
		renderFrameCount: 1_024,
		track: editableTrack,
		clips: [clip],
		sourceContentIdentities: [{ sourceId: liveSource.id, contentSha256: liveSource.contentSha256 }],
		automationLanes,
		tempoMap: null,
	});
	const track = createAudioTrack({
		id: 'voice', name: 'Voice', clipIds: ['voice-clip'], effects: [effect, automationEffect],
		audioFreeze: freezeRecord(digests),
	});
	return createSoundscaperProject({
		id: 'freeze-project', title: 'Freeze project', now: NOW,
		sources: [liveSource, derivedSource], clips: [clip], tracks: [track],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
		automationLanes,
	});
}

function freezeRecord(digests: AudioTrackFreezeDigestsV1): AudioTrackFreezeV1 {
	return {
		schemaVersion: 1,
		derivedSourceId: 'voice-freeze',
		...digests,
		renderStartFrame: 64,
		renderFrameCount: 1_024,
		capturePosition: 'post-insert-pre-strip',
	};
}

function trackRecord(project: Record<string, unknown>): Record<string, unknown> {
	return (project.tracks as Array<Record<string, unknown>>).find(({ id }) => id === 'voice')!;
}

function sourceRecord(project: Record<string, unknown>, id: string): Record<string, unknown> {
	return (project.sources as Array<Record<string, unknown>>).find((source) => source.id === id)!;
}
