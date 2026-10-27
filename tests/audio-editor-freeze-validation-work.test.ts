/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { computeAudioTrackFreezeDigestsV1 } from '../src/common/editor/audio-track-freeze-v21.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { normalizeProjectFeatureRequirements } from '../src/common/editor/project-feature-requirements.ts';

const NOW = '2026-10-26T00:00:00.000Z';
function frozenProject(count: number) {
	const sha = 'ab'.repeat(32);
	const freeze = { schemaVersion: 1, derivedSourceId: 'frozen', inputDigestSha256: sha, rackDigestSha256: sha,
		automationDigestSha256: sha, freshnessDigestSha256: sha, renderStartFrame: 0, renderFrameCount: count * 64,
		capturePosition: 'post-insert-pre-strip' };
	const stale = createSoundscaperProject({ id: 'freeze-work', now: NOW, sources: [
		{ id: 'source', storageKey: 'source', frameCount: 64, channelCount: 2, sampleRate: 48_000, contentSha256: sha },
		{ id: 'frozen', storageKey: 'frozen', frameCount: count * 64, channelCount: 2, sampleRate: 48_000, contentSha256: sha }],
		clips: Array.from({ length: count }, (_, index) => ({ id: `clip-${index}`, sourceId: 'source', sourceStartFrame: 0,
			sourceDurationFrames: 64, durationFrames: 64, timelineStartFrame: index * 64 })),
		tracks: [{ id: 'track', clipIds: Array.from({ length: count }, (_, index) => `clip-${index}`), audioFreeze: freeze }] });
	const digests = computeAudioTrackFreezeDigestsV1({ sampleRate: stale.sampleRate, renderStartFrame: 0,
		renderFrameCount: count * 64, track: stale.tracks[0]!, clips: stale.clips,
		sourceContentIdentities: [{ sourceId: 'source', contentSha256: sha }], automationLanes: stale.automationLanes, tempoMap: stale.tempoMap });
	return createSoundscaperProject({ ...stale, now: NOW, tracks: [{ ...stale.tracks[0]!, audioFreeze: { ...freeze, ...digests } }],
		featureRequirements: { ...stale.featureRequirements,
			requirements: stale.featureRequirements.requirements.filter(row => row.featureId !== PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze) } });
}

test('renaming a real fresh many-clip frozen track indexes fallback and freshness membership', () => {
	const count = 500, project = frozenProject(count);
	assert.equal(project.featureRequirements.requirements.find(row => row.featureId === PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze)?.disposition, 'rendered-fallback');
	const original = Array.prototype.filter;
	let visits = 0;
	Array.prototype.filter = function<T>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown, receiver?: unknown): T[] {
		if (this.length !== count || (this[0] as { id?: unknown })?.id !== 'clip-0'
			|| !/validateAudioFreezeTrackFallback|documentFreezeDigests/.test(new Error().stack ?? '')) return original.call(this, predicate, receiver);
		return original.call(this, (value: T, index: number, array: T[]) => { visits++; return predicate.call(receiver, value, index, array); });
	};
	try {
		assert.equal(validateSoundscaperProject(project), true);
		const renamed = applySoundscaperProjectCommand(project, { type: 'project/rename', title: 'Fresh frozen track' }, { now: NOW });
		assert.equal(renamed.title, 'Fresh frozen track');
		assert.deepEqual(renamed.tracks[0]!.audioFreeze, project.tracks[0]!.audioFreeze);
		assert.deepEqual(renamed.featureRequirements, project.featureRequirements);
		assert.ok(visits <= count * 100, `${visits} full-catalog freeze membership predicates`);
	} finally { Array.prototype.filter = original; }
});

test('fresh invocation indexes retain exact missing and duplicate clip refusals and content freshness', () => {
	const project = frozenProject(2);
	const context = { sources: project.sources, clips: project.clips, tracks: project.tracks,
		schemaVersion: project.schemaVersion, sampleRate: project.sampleRate, sequences: project.sequences, primarySequenceId: project.primarySequenceId };
	for (const clips of [project.clips.slice(1), [...project.clips, project.clips[0]!]]) {
		assert.throws(() => normalizeProjectFeatureRequirements(project.featureRequirements, { ...context, clips }), /references a missing timeline clip/);
	}
	assert.throws(() => normalizeProjectFeatureRequirements(project.featureRequirements, { ...context, tracks: [...project.tracks, project.tracks[0]!] }), /exactly one target track/);
	assert.throws(() => normalizeProjectFeatureRequirements(project.featureRequirements, { ...context, sources: [...project.sources, project.sources[0]!] }), /Duplicate project source ID/);
	const changed = { ...project, sources: project.sources.map((source, index) => index === 0 ? { ...source, contentSha256: 'cd'.repeat(32) } : source) };
	assert.throws(() => validateSoundscaperProject(changed), /freeze requirement/);
	assert.equal(validateSoundscaperProject(project), true);
});
