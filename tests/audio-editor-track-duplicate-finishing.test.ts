/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { applyFramescaperProjectCommand, prepareFramescaperVideoTransitionAllocations } from '../src/framescaper/editor-project-commands.ts';
import { normalizeVideoVisualPresentationV1 } from '../src/common/editor/video-visual-presentation-v27.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';
import { createTrackDuplicationService } from '../src/common/editor/controller/document/internal/track-duplication-service.ts';
import { createAddTrackCommand, createAddClipCommand } from '../src/common/editor/commands/factories.ts';

test('Duplicate Track preserves clip-owned camera finishing', () => {
	let project = createFramescaperProject(PROFILE, framescaperBaselineOptions());
	const presentation = normalizeVideoVisualPresentationV1({ schemaVersion: 1, id: 'finishing',
		owner: { kind: 'clip', id: 'video-clip' }, enabled: true, opacity: 0.5, blendMode: 'normal',
		grade: null, processorStackId: null, maskMatteIds: [] });
	project = applyFramescaperProjectCommand(PROFILE, project, { type: 'video-visual-presentation/set',
		presentationId: presentation.id, expectedPresentation: null, presentation });
	let serial = 0;
	const createId = (prefix = 'id') => `${prefix}-${++serial}`;
	const service = createTrackDuplicationService({ lifetime: { assertActive() {} }, editingBlocked: () => false,
		copySuffix: 'copy', getProject: () => project, createId,
		findClip: (value, id) => value.clips.find(clip => clip.id === id) ?? null,
		cloneVideoEffects: effects => effects.map(effect => ({ ...structuredClone(effect), id: createId('effect') })),
		createAddTrackCommand, createAddClipCommand,
		commit: command => { project = applyFramescaperProjectCommand(PROFILE, project,
			prepareFramescaperVideoTransitionAllocations(PROFILE, project, command, createId)); } });
	service.duplicateTrack(project.tracks.find(track => track.type === 'video'));
	const copied = project.clips.find(clip => clip.kind === 'video' && clip.id !== 'video-clip');
	assert.ok(copied, 'the duplicated track contains its copied camera clip');
	assert.ok(Array.isArray(project.videoVisualPresentations));
	const finishes = project.videoVisualPresentations.map(normalizeVideoVisualPresentationV1);
	assert.equal(finishes.find(value => value.owner.kind === 'clip' && value.owner.id === copied.id)?.opacity, 0.5);
	assert.equal(finishes.find(value => value.id === 'finishing')?.opacity, 0.5);
});
