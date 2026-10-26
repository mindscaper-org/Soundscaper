/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioGeneratorService, type AudioGeneratorDocument } from '../src/common/editor/controller/edit/generator-service.ts';
import { createLabeledAudioEditService } from '../src/common/editor/controller/edit/internal/labeled-audio-edit-service.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createFixture } from './helpers/audio-editor-generator-service-fixture.ts';

function fixture() {
	const count = 500;
	const regions = Array.from({ length: count }, (_, index) => ({ startFrame: index * 16 + 2, endFrame: index * 16 + 14 }));
	const project = createSoundscaperProject({ id: 'project-a',
		sources: [{ id: 'source', storageKey: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 8 }],
		clips: Array.from({ length: count * 2 }, (_, index) => ({ id: `c${index}`, sourceId: 'source',
			sourceStartFrame: 0, sourceDurationFrames: 8, timelineStartFrame: index * 8, durationFrames: 8 })),
		tracks: [{ id: 'track', clipIds: Array.from({ length: count * 2 }, (_, index) => `c${index}`) },
			{ id: 'labels', type: 'label', labels: regions.map((region, index) => ({ id: `label${index}`, ...region })) }],
		selection: { startFrame: 0, endFrame: count * 16, trackIds: ['track', 'labels'] },
	});
	assert.ok(validateSoundscaperProject(project));
	return { project, regions, count };
}

test('labeled silence intersects sorted interval unions without comparing every clip and region', async () => {
	const { project, regions, count } = fixture();
	const quotaFailure = new Error('Storage quota declined');
	const estimates: number[] = [];
	const generator = createFixture({ getProject: () => project as unknown as AudioGeneratorDocument,
		preflightStorage: async bytes => { estimates.push(bytes); throw quotaFailure; } });
	const original = Math.min;
	let intersections = 0;
	Math.min = (...values: number[]) => { intersections++; return original(...values); };
	try {
		await assert.rejects(createAudioGeneratorService(generator.dependencies).generateLabeledSilence(regions, ['track']), error => error === quotaFailure);
		assert.deepEqual(estimates, [(12 + 1) * Float32Array.BYTES_PER_ELEMENT]);
		assert.ok(intersections <= count * 20, `received ${intersections} interval minimum calculations`);
	} finally { Math.min = original; }
});

test('joining disjoint labeled pairs resolves and emits each participating clip with bounded work', () => {
	const { project, count } = fixture();
	let reads = 0;
	const measured = { ...project, clips: project.clips.map(clip => ({ ...clip, get id() { reads++; return clip.id; } })) };
	const commits: AudioEditorCommand[] = [];
	const errors: unknown[] = [];
	createLabeledAudioEditService({ state: { selectedTrackId: 'track' }, getProject: () => measured,
		activeSelection: () => project.selection,
		findClip: (value: typeof measured, id: string) => value.clips.find(clip => clip.id === id),
		commit: (command: AudioEditorCommand) => { commits.push(command); }, handleError: (error: unknown) => { errors.push(error); },
	})('labeled-join');
	assert.deepEqual(errors, []);
	assert.equal(commits.length, 1);
	const command = commits[0];
	assert.ok(command?.type === 'batch');
	assert.equal(command.commands.length, count);
	for (const [index, child] of command.commands.entries()) assert.deepEqual(child, { type: 'clip/join', clipIds: [`c${index * 2}`, `c${index * 2 + 1}`] });
	assert.ok(reads <= count * 20, `received ${reads} participating clip identity reads`);
});
