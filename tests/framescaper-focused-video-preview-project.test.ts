/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { focusVideoPreviewProjects, focusedVideoPreviewSequenceId } from '../src/common/editor/ui/workspace/video-preview-focused-project.ts';
import { isRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import type { VideoSourceTimingView } from '../src/common/editor/video-source-timing-view.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { framescaperProjectForRuntimeConsumersFinishing } from '../src/framescaper/editor-project-finishing-runtime.ts';
import { createFramescaperSelectedVisualPreviewSessionFinishing } from '../src/framescaper/editor-selected-finishing-visual-preview.ts';
import { createSelectedPreviewPlan } from '../src/framescaper/selected-preview-plan.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

function fixture(primaryPicture = false) {
	const options = framescaperV20Options();
	const clips = options.clips as Data[], tracks = options.tracks as Data[], sequences = options.sequences as Data[];
	for (const clip of clips) if (clip.kind === 'video') clip.sequenceId = 'cut';
	for (const clip of (options.projectBin as Data).clips as Data[]) clip.sequenceId = 'cut';
	sequences[0]!.id = 'cut';
	sequences.push({ id: 'main', rate: { num: 30, den: 1 }, trackIds: primaryPicture ? ['primary-track'] : [] });
	if (primaryPicture) {
		clips.push({ ...clips[0], id: 'primary-camera', sequenceId: 'main', sequenceFrameCount: 30 });
		tracks.push({ ...tracks[0], id: 'primary-track', clipIds: ['primary-camera'] });
	}
	options.primarySequenceId = 'main';
	options.selection = { clipIds: ['video-clip'] };
	const canonical = createFramescaperProjectFinishing(PROFILE, options as never);
	const preview = framescaperProjectForRuntimeConsumersFinishing(PROFILE, canonical);
	return { canonical, preview };
}

void test('a selected secondary camera gets an executable preview without changing the persisted primary', () => {
	const { canonical, preview } = fixture();
	const sequenceId = focusedVideoPreviewSequenceId(canonical, 'video-clip');
	assert.equal(sequenceId, 'cut');
	const focused = focusVideoPreviewProjects(canonical, preview, sequenceId);
	assert.equal(canonical.primarySequenceId, 'main');
	assert.equal(focused.canonicalProject.primarySequenceId, 'cut');
	assert.equal(focused.canonicalProject.id, canonical.id);
	assert.equal(focused.canonicalProject.revision, canonical.revision);
	assert.equal(focused.canonicalProject.clips, canonical.clips);
	assert.equal(focused.canonicalProject.tracks, canonical.tracks);
	assert.equal(focused.canonicalProject.sequences, canonical.sequences);
	assert.equal(focused.canonicalProject.sources, canonical.sources);
	assert.equal(focused.project.primarySequenceId, 'cut');
	assert.ok(isRuntimeProjectProjection(preview));
	assert.ok(isRuntimeProjectProjection(focused.project), 'scoping retains genuine resolved-coordinate authority');
	const timing = new Map<string, VideoSourceTimingView>([['video-source', {
		kind: 'cfr', rate: { num: 10, den: 1 }, frameCount: 10,
	}]]);
	assert.throws(() => createSelectedPreviewPlan(PROFILE, canonical as unknown as Data,
		{ width: 4, height: 2 }, timing, false), /non-empty picture range/u);
	const plan = createSelectedPreviewPlan(PROFILE, focused.canonicalProject as unknown as Data,
		{ width: 4, height: 2 }, timing, false);
	assert.ok(plan.nodes.length > 0);
	assert.deepEqual(plan.timebase.sequenceRate, { num: 10, den: 1 });
});

void test('native preview scoping excludes another populated sequence while retaining the authored graph', () => {
	const { canonical, preview } = fixture(true);
	const focused = focusVideoPreviewProjects(canonical, preview, focusedVideoPreviewSequenceId(canonical, 'video-clip'));
	assert.deepEqual((focused.project.tracks as Data[]).map(track => track.id), ['video-track', 'audio-track']);
	assert.deepEqual((focused.project.clips as Data[]).map(clip => clip.id), ['video-clip', 'audio-clip']);
	assert.ok((focused.canonicalProject.clips as readonly unknown[]).length === 3);
	assert.ok(isRuntimeProjectProjection(focused.project));
});

void test('no valid selection and non-Frame products preserve both original project identities', () => {
	const { canonical, preview } = fixture();
	const selection = canonical.selection;
	assert.ok(selection && typeof selection === 'object' && !Array.isArray(selection));
	for (const owner of [
		{ ...canonical, selection: { ...selection, clipIds: [] } },
		{ ...canonical, selection: { ...selection, clipIds: ['missing'] } },
		{ ...canonical, schemaFamily: 'soundscaper' },
	]) {
		const sequenceId = focusedVideoPreviewSequenceId(owner, 'video-clip');
		assert.equal(sequenceId, null);
		const focused = focusVideoPreviewProjects(owner, preview, sequenceId);
		assert.equal(focused.canonicalProject, owner); assert.equal(focused.project, preview);
	}
	assert.equal(focusedVideoPreviewSequenceId(canonical, 'remembered-but-unselected'), 'cut');
	assert.equal(focusedVideoPreviewSequenceId(null, 'video-clip'), null);
});

void test('an empty primary retains the preview factory non-empty-range refusal', async () => {
	const { canonical } = fixture();
	await assert.rejects(createFramescaperSelectedVisualPreviewSessionFinishing({ profile: PROFILE,
		project: canonical, width: 4, height: 2,
		store: { loadMediaAsset: async () => { throw new Error('An empty sequence must not load media.'); } } as never }),
	/requires a non-empty picture range/u);
});
