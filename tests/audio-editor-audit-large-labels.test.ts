/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { audioTrackChannelCount } from '../src/common/editor/project-audio-factory.js';
import { labeledAudioSpanRegions, selectLabeledAudioTargets } from '../src/common/editor/labeled-audio-regions.ts';
import { createAudioGeneratorService, type AudioGeneratorDocument } from '../src/common/editor/controller/edit/generator-service.ts';
import { parseSubRipLabels, parseWebVttLabels, serializeSubRipLabels, serializeWebVttLabels } from '../src/common/editor/label-io.js';
import { createFixture } from './helpers/audio-editor-generator-service-fixture.ts';

test('an admitted many-track labeled edit reaches storage preflight with the correct shared silence estimate', async () => {
	const labelCount = 5_000;
	const trackCount = 30;
	const end = labelCount * 24_000;
	const project = createSoundscaperProject({ id: 'large-label-edit',
		sources: [{ id: 'source', storageKey: 'source', sampleRate: 48_000, channelCount: 2, frameCount: end }],
		tracks: [
			...Array.from({ length: trackCount }, (_, index) => ({ id: `t${index}`, clipIds: [`c${index}`] })),
			{ id: 'labels', type: 'label', labels: Array.from({ length: labelCount }, (_, index) => ({
				id: `l${index}`, title: `Region ${index}`, startFrame: index * 24_000, endFrame: index * 24_000 + 12_000,
			})) },
		],
		clips: Array.from({ length: trackCount }, (_, index) => ({ id: `c${index}`, sourceId: 'source',
			sourceStartFrame: 0, sourceDurationFrames: end, timelineStartFrame: 0, durationFrames: end })),
	});
	assert.ok(validateSoundscaperProject(project));
	const targets = selectLabeledAudioTargets(project, { startFrame: 0, endFrame: end }, project.tracks.map(track => track.id));
	const quotaFailure = new Error('Storage quota declined');
	const estimates: number[] = [];
	const fixture = createFixture({ getProject: () => project as unknown as AudioGeneratorDocument,
		trackChannelCount: audioTrackChannelCount,
		preflightStorage: async bytes => { estimates.push(bytes); throw quotaFailure; },
	});
	fixture.dependencies.projectGeneration.activate(project.id);
	await assert.rejects(createAudioGeneratorService(fixture.dependencies).generateLabeledSilence(
		labeledAudioSpanRegions(targets.regions), targets.trackIds), error => error === quotaFailure);
	assert.deepEqual(estimates, [(12_000 + 1) * 2 * Float32Array.BYTES_PER_ELEMENT]);
	assert.equal(fixture.commits.length, 0);
	assert.equal(fixture.state.audacityEffectProcessing, false);
});

test('an imported large multiline subtitle cue roundtrips through both timed label exporters', () => {
	const title = Array.from({ length: 150_000 }, (_, index) => index === 75_000 ? '<middle>&' : 'x').join('\n');
	const imported = parseSubRipLabels(`1\n00:00:00,000 --> 00:00:01,000\n${title}\n`, { sampleRate: 48_000 });
	assert.equal(imported.labels.length, 1);
	for (const [serialize, parse] of [[serializeSubRipLabels, parseSubRipLabels], [serializeWebVttLabels, parseWebVttLabels]] as const) {
		const restored = parse(serialize(imported.labels, { sampleRate: 48_000 }), { sampleRate: 48_000 });
		assert.equal(restored.labels.length, 1);
		assert.equal(restored.labels[0]?.title, imported.labels[0]?.title);
		assert.equal(restored.labels[0]?.startFrame, 0);
		assert.equal(restored.labels[0]?.endFrame, 48_000);
	}
});
