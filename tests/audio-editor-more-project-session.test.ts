/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createProjectSessionSelectionService } from '../src/common/editor/controller/document/internal/project/project-session-selection-service.ts';

test('MP07: opening a project restores its durable active track and annotation selection', () => {
	const project = createSoundscaperProject({ id: 'project',
		tracks: [createAudioTrack({ id: 'first' }), createAudioTrack({ id: 'second' })],
		timelineAnnotations: [{ id: 'cue', sequenceId: 'main-sequence', kind: 'marker', anchor: 'sample',
			positionFrame: 0, name: 'Cue', color: 'auto', batchId: null, opaqueExtensions: {} }],
		selection: { trackIds: ['second'], annotationIds: ['cue'] },
	});
	const state = { selectedTrackId: null as string | null, selectedClipId: null as string | null,
		selectedAnnotationId: null as string | null, selectedLabels: [] };
	const service = createProjectSessionSelectionService({ state,
		findTrack: (value: typeof project, id) => value.tracks.find((track) => track.id === id) ?? null,
		findClip: () => null,
	});
	service.restore(project);
	assert.equal(state.selectedTrackId, 'second');
	assert.equal(state.selectedAnnotationId, 'cue');
});
