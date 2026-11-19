/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import React, { act } from 'react';
import VideoCompositionDialog from '../src/common/editor/ui/inspector/VideoCompositionDialog.tsx';
import { DEFAULT_VIDEO_CLIP_COMPOSITION, normalizeVideoClipComposition } from '../src/common/editor/video-clip-composition.ts';
import { loadVideoTimingAsset } from '../src/common/editor/video-timing-storage.ts';
import { videoPreviewBenchmarkMedia } from './browser/fixtures/video-preview-benchmark-media.js';
import { webmSourceFactsCustody } from './helpers/framescaper-webm-source-facts-custody.ts';
import { currentReviewedVideoProject } from './helpers/reviewed-video-project-custody.ts';
import { reopenVisualAuthoringArchive } from './helpers/framescaper-visual-authoring-archive-custody.ts';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { reactProps } from './helpers/react-test-dom.ts';

function authored(value: unknown) {
	const { revision: _revision, updatedAt: _updatedAt, selection: _selection, ...document } = currentReviewedVideoProject(value);
	return document;
}

test('actual imported picture and composition dialog preserve precise rotation, unchanged Redo and fresh Scape', async context => {
	const media = videoPreviewBenchmarkMedia;
	assert.equal(createHash('sha256').update(media.file.buffer).digest('hex'), media.sourceSha256);
	const editor = await webmSourceFactsCustody(context, 'timeline');
	const result = await editor.importVideo(new File([Uint8Array.from(media.file.buffer)], media.file.name, { type: media.file.mimeType }));
	assert.deepEqual([result.destination, result.audioSourceId, result.notice], ['timeline', null, undefined]);
	assert.deepEqual(editor.nativeCalls, []);
	const imported = currentReviewedVideoProject(editor.controller.project);
	const source = imported.sources.find(source => source.id === result.sourceId); assert.ok(source?.kind === 'video');
	assert.deepEqual([source.width, source.height, source.sourceFrameCount, source.contentSha256], [1280, 720, 179, media.sourceSha256]);
	const timing = await loadVideoTimingAsset(editor.environment.store, source.timingAsset, { sourceSha256: media.sourceSha256 });
	assert.equal(timing.status, 'available'); assert.equal(timing.index?.frameCount, 179);
	await editor.controller.actions.timeline.selectClip(result.clipId);
	const fixture = mountControllerDataDom();
	let session = 0;
	const clipComposition = (value: unknown) => {
		const clip = currentReviewedVideoProject(value).clips.find(clip => clip.id === result.clipId); assert.ok(clip?.kind === 'video');
		return normalizeVideoClipComposition(clip.videoComposition);
	};
	// Each original menu opening mounts a fresh dialog draft after its preceding Apply/Close.
	const render = async () => { await fixture.render(<VideoCompositionDialog key={++session} productId="framescaper" capability controller={editor.controller}
		snapshot={{ project: editor.controller.project, selectedClipId: result.clipId }} copy={{}} run={fixture.run} onClose={() => undefined} />); };
	const apply = async () => { await act(async () => {
		reactProps(fixture.dom.one('[id="video-composition-form"]')).onSubmit({ preventDefault() {} }); await fixture.settle();
	}); };
	try {
		await render();
		assert.deepEqual(clipComposition(imported), DEFAULT_VIDEO_CLIP_COMPOSITION);
		const initial = currentReviewedVideoProject(editor.controller.project), entries = editor.controller.getSnapshot().history.undoEntries.length;
		const rotation = 0.123456789012345;
		await act(async () => { reactProps(fixture.dom.one('[data-video-composition-field="rotation"]')).onChange({ currentTarget: { value: String(rotation) } }); });
		await apply();
		const rotated = currentReviewedVideoProject(editor.controller.project);
		const expectedRotation = { ...DEFAULT_VIDEO_CLIP_COMPOSITION, transform: { ...DEFAULT_VIDEO_CLIP_COMPOSITION.transform, rotationDegrees: rotation } };
		assert.deepEqual(clipComposition(rotated), expectedRotation);
		const geometry = rotated.featureRequirements.requirements.filter(requirement => requirement.id === 'framescaper.video-geometry');
		assert.deepEqual(geometry, [{ id: 'framescaper.video-geometry', featureId: 'org.soundscaper.capability.video-geometry',
			displayName: 'Video transforms and compositing', disposition: 'bypass', fallback: null }]);
		assert.deepEqual(rotated.featureRequirements.requirements.filter(requirement => requirement.id !== 'framescaper.video-geometry'), initial.featureRequirements.requirements);
		assert.deepEqual(authored(rotated), { ...authored(initial), featureRequirements: rotated.featureRequirements,
			clips: initial.clips.map(clip => clip.id === result.clipId ? { ...clip, videoComposition: expectedRotation } : clip) });
		await editor.controller.actions.project.flush(); assert.deepEqual(await editor.environment.store.loadProject(rotated.id), editor.controller.project);
		await render();
		await act(async () => { reactProps(fixture.dom.one('[data-video-composition-field="flip-horizontal"]')).onChange({ currentTarget: { checked: true } }); });
		await apply();
		const flipped = currentReviewedVideoProject(editor.controller.project);
		const expectedFlip = { ...expectedRotation, transform: { ...expectedRotation.transform, flipHorizontal: true } };
		assert.deepEqual(clipComposition(flipped), expectedFlip);
		assert.equal(editor.controller.getSnapshot().history.undoEntries.length, entries + 2);
		await editor.controller.actions.project.flush(); assert.deepEqual(await editor.environment.store.loadProject(flipped.id), editor.controller.project);
		await editor.controller.actions.edit.undo(); assert.deepEqual(authored(editor.controller.project), authored(rotated));
		const history = structuredClone(editor.controller.getSnapshot().history), unchanged = currentReviewedVideoProject(editor.controller.project);
		assert.ok(history.redoEntries.length > 0);
		await render(); await apply();
		assert.deepEqual(editor.controller.getSnapshot().history, history, 'unchanged Apply preserves the complete real Redo stack');
		assert.deepEqual(editor.controller.project, unchanged);
		await editor.controller.actions.edit.redo(); assert.deepEqual(authored(editor.controller.project), authored(flipped));
		await render(); assert.equal(fixture.dom.one('[data-video-composition-field="flip-horizontal"]').checked, true);
		await editor.controller.actions.project.flush();
		const current = currentReviewedVideoProject(editor.controller.project); assert.deepEqual(await editor.environment.store.loadProject(current.id), current);
		const mediaBytes = new Map([[source.storageKey, Uint8Array.from(media.file.buffer)]]);
		const timingBlob = await editor.environment.store.loadMediaAsset(source.timingAsset?.storageKey ?? ''); assert.ok(timingBlob instanceof Blob);
		mediaBytes.set(source.timingAsset!.storageKey, new Uint8Array(await timingBlob.arrayBuffer()));
		const reopened = await reopenVisualAuthoringArchive(current, editor.environment.store, mediaBytes);
		assert.deepEqual(clipComposition(reopened), expectedFlip);
	} finally { await fixture.dispose(); }
});
