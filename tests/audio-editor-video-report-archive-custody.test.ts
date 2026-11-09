/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_VIDEO_CLIP_COMPOSITION, normalizeVideoClipComposition } from '../src/common/editor/video-clip-composition.ts';
import { createVideoCompositionCommitCommand } from '../src/common/editor/ui/video-composition-dialog-model.ts';
import { normalizeVideoRetimeCurveV16 } from '../src/common/editor/video-retime-v16.ts';
import { validateFramescaperMulticameraGroupsSequence } from '../src/framescaper/editor-project-sequence-multicam.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { currentReviewedVideoProject } from './helpers/reviewed-video-project-custody.ts';
import { reviewedCameraFiles, reviewedSilentWebm, reviewedVideoReportCustody, reportSequenceActions, deliveredVideoReport, otioVideoClips } from './helpers/reviewed-video-report-custody.ts';
import { readWithReference, referenceItems } from './helpers/interchange-reference.ts';

for (const switched of [false, true]) test(`real multicamera switched=${switched} preserves literal active source/duration and accurate OTIO report through archive and file action`, async context => {
	const fixture = await reviewedVideoReportCustody(context, reviewedCameraFiles);
	fixture.controller.actions.track.update('pictures-1', { hidden: true });
	if (switched) {
		const actions = reportSequenceActions(fixture.controller.actions.sequences);
		let project = currentReviewedVideoProject(fixture.controller.project);
		actions.createMulticamera(project.id, project.revision, { id: 'group', projectId: project.id, sequenceId: 'main', outputClipId: 'picture-0', activeMemberId: 'front',
			members: [{ id: 'front', groupId: 'group', sourceId: 'camera-0', syncOffsetSamples: 0 }, { id: 'side', groupId: 'group', sourceId: 'camera-1', syncOffsetSamples: 0 }] });
		project = currentReviewedVideoProject(fixture.controller.project);
		actions.switchMulticamera(project.id, project.revision, 'group', 'front', 'side');
		fixture.controller.actions.edit.undo();
		assert.equal(validateFramescaperMulticameraGroupsSequence(PROFILE, currentReviewedVideoProject(fixture.controller.project), fixture.controller.project?.multicameraGroups)[0]?.activeMemberId, 'front');
		fixture.controller.actions.edit.redo();
	}
	const recipient = await fixture.reopen();
	assert.deepEqual(recipient.project.sources.map(source => [source.id, source.name, source.kind === 'video' ? source.sourceFrameCount : 0]), [['camera-0', 'camera-0.mp4', 22], ['camera-1', 'camera-1.mp4', 22]]);
	assert.equal(recipient.project.clips.find(clip => clip.id === 'picture-0')?.sequenceFrameCount, 22);
	const before = structuredClone(recipient.project);
	const result = await recipient.controller.actions.export.exportOtio();
	const report = deliveredVideoReport(result);
	assert.deepEqual(recipient.controller.getSnapshot().deliveryReport, report);
	assert.equal(fixture.saved.length, 1);
	const file = fixture.saved[0]; assert.ok(file); assert.match(file.name, /\.otio$/u);
	const clips = otioVideoClips(await file.text()); assert.equal(clips.length, 1);
	assert.deepEqual(clips[0]?.source_range, { OTIO_SCHEMA: 'TimeRange.1', start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 25 }, duration: { OTIO_SCHEMA: 'RationalTime.1', value: 22, rate: 25 } });
	const reference: unknown = clips[0]?.media_reference; assert.ok(reference && typeof reference === 'object');
	assert.equal(Reflect.get(reference, 'target_url'), switched ? 'camera-1' : 'camera-0');
	const metadata: unknown = Reflect.get(reference, 'metadata'); assert.ok(metadata && typeof metadata === 'object');
	const owned: unknown = Reflect.get(metadata, 'media.kw.soundscaper'); assert.ok(owned && typeof owned === 'object');
	assert.equal(Reflect.get(owned, 'sourceId'), switched ? 'camera-1' : 'camera-0');
	const warnings = report.items.filter(item => item.code === 'otio.multicamera-flattened');
	assert.equal(warnings.length, switched ? 1 : 0);
	if (switched) {
		assert.equal(warnings[0]?.severity, 'warning'); assert.equal(warnings[0]?.disposition, 'converted');
		assert.deepEqual(warnings[0]?.scope, { kind: 'multicamera-group', id: 'group' });
		assert.deepEqual(warnings[0]?.data, { activeSourceId: 'camera-1', memberCount: 2, outputClipId: 'picture-0' });
	}
	assert.deepEqual(recipient.controller.project, before);
});

for (const opacity of [1, .5]) test(`actual opacity${opacity} survives history/store/archive while OTIO omits processing and reports only authored loss`, async context => {
	const fixture = await reviewedVideoReportCustody(context, reviewedCameraFiles.slice(0, 1));
	if (opacity !== 1) {
		const command = createVideoCompositionCommitCommand(fixture.controller.project, 'picture-0', DEFAULT_VIDEO_CLIP_COMPOSITION, { ...DEFAULT_VIDEO_CLIP_COMPOSITION, opacity });
		await fixture.controller.actions.edit.commit(command);
		fixture.controller.actions.edit.undo();
		assert.equal(normalizeVideoClipComposition(fixture.controller.project?.clips[0]?.videoComposition).opacity, 1);
		fixture.controller.actions.edit.redo();
	}
	const recipient = await fixture.reopen();
	assert.equal(normalizeVideoClipComposition(recipient.project.clips[0]?.videoComposition).opacity, opacity);
	const before = structuredClone(recipient.project);
	const result = await recipient.controller.actions.export.exportOtio();
	const report = deliveredVideoReport(result);
	assert.deepEqual(recipient.controller.getSnapshot().deliveryReport, report);
	const file = fixture.saved[0]; assert.ok(file); assert.equal(fixture.saved.length, 1);
	const clips = otioVideoClips(await file.text()); assert.equal(clips.length, 1);
	assert.deepEqual(clips[0]?.effects ?? [], []);
	const warning = report.items.filter(item => item.code === 'otio.picture-processing-omitted');
	assert.equal(warning.length, opacity === 1 ? 0 : 1);
	if (opacity !== 1) {
		assert.equal(warning[0]?.severity, 'warning'); assert.equal(warning[0]?.disposition, 'omitted');
		assert.deepEqual(warning[0]?.scope, { kind: 'clip', id: 'picture-0' });
		assert.deepEqual(warning[0]?.data, { videoComposition: { ...DEFAULT_VIDEO_CLIP_COMPOSITION, opacity: .5 } });
	}
	assert.deepEqual(recipient.controller.project, before);
});

for (const overlap of [false, true]) test(`actual bin cut overlap=${overlap} preserves literal placement and independently read EDL/report through portable reopening`, async context => {
	const fixture = await reviewedVideoReportCustody(context, [reviewedSilentWebm], { num: 30, den: 1 });
	assert.deepEqual(fixture.controller.actions.projectBin.moveFromTimeline('picture-0'), ['picture-0']);
	const first = fixture.controller.actions.projectBin.place('picture-0', { trackId: 'pictures-0', timelineStartFrame: 0 }); assert.ok(typeof first === 'string');
	const second = fixture.controller.actions.projectBin.place('picture-0', { trackId: 'pictures-0', timelineStartFrame: overlap ? 16_000 : 43_200 }); assert.ok(typeof second === 'string');
	fixture.controller.actions.edit.undo(); assert.equal(fixture.controller.project?.clips.length, 1);
	fixture.controller.actions.edit.redo();
	const recipient = await fixture.reopen();
	assert.deepEqual(recipient.project.clips.map(clip => [clip.sequenceStartFrame, clip.sequenceFrameCount]), [[0, 27], [overlap ? 10 : 27, 27]]);
	const before = structuredClone(recipient.project);
	const result = await recipient.controller.actions.export.exportEdl();
	const report = deliveredVideoReport(result);
	const file = fixture.saved[0]; assert.ok(file); assert.equal(fixture.saved.length, 1); assert.match(file.name, /\.edl$/u);
	const text = await file.text();
	const cuts = text.split('\n').filter(line => /^\d{3}\s/u.test(line)).map(line => line.trim().split(/\s+/u).slice(4));
	assert.deepEqual(cuts, [
		['00:00:00:00', '00:00:00:27', '00:00:00:00', '00:00:00:27'],
		['00:00:00:00', '00:00:00:27', overlap ? '00:00:00:10' : '00:00:00:27', overlap ? '00:00:01:07' : '00:00:01:24'],
	]);
	if (overlap) assert.throws(() => readWithReference(text, 'cmx_3600', { rate: 30 }, '.edl'), /Overlapping record in value/u);
	else assert.equal(referenceItems(readWithReference(text, 'cmx_3600', { rate: 30 }, '.edl')).filter(item => item.schema === 'Clip').length, 2);
	const warnings = report.items.filter(item => item.code === 'edl.overlapping-cuts-unsupported'); assert.equal(warnings.length, overlap ? 1 : 0);
	if (overlap) {
		assert.equal(warnings[0]?.severity, 'warning'); assert.equal(warnings[0]?.disposition, 'omitted');
		assert.deepEqual(warnings[0]?.scope, { kind: 'clip', id: second });
		// The disclosed intersection is[10,27); the second delivered cut ends37.
		assert.deepEqual(warnings[0]?.data, { overlappingClipIds: [first], recordInFrames: 10, recordOutFrames: 27 });
	}
	assert.deepEqual(recipient.controller.getSnapshot().deliveryReport, report); assert.deepEqual(recipient.controller.project, before);
});

for (const frozen of [false, true]) test(`actual retime frozen=${frozen} preserves its source clock/history/archive and publishes exact EDL motion disclosure`, async context => {
	const fixture = await reviewedVideoReportCustody(context, [reviewedSilentWebm], { num: 30, den: 1 });
	if (frozen) {
		reportSequenceActions(fixture.controller.actions.sequences).retimeFreeze({ clipId: 'picture-0', expectedRetimeMap: null, sourceFrame: { num: 2, den: 1 } });
		fixture.controller.actions.edit.undo(); assert.equal(fixture.controller.project?.clips[0]?.retimeMap, null);
		fixture.controller.actions.edit.redo();
	}
	const recipient = await fixture.reopen();
	const before = structuredClone(recipient.project);
	assert.equal(Boolean(recipient.project.clips[0]?.retimeMap), frozen);
	const curve = normalizeVideoRetimeCurveV16(recipient.project.clips[0]?.retimeMap, { sequenceFrameCount: 27, sourceInFrame: 0, sourceFrameCount: 13 });
	if (frozen) {
		assert.deepEqual(curve?.points, [{ outerFrame: 0, sourceFrame: { num: 2, den: 1 } }, { outerFrame: 27, sourceFrame: { num: 2, den: 1 } }]);
		assert.deepEqual(curve?.segments, [{ mode: 'freeze' }]);
	} else assert.equal(curve, null);
	const result = await recipient.controller.actions.export.exportEdl();
	const report = deliveredVideoReport(result);
	const file = fixture.saved[0]; assert.ok(file); assert.equal(fixture.saved.length, 1);
	const events = (await file.text()).split('\n').filter(line => /^\d{3}\s/u.test(line)); assert.equal(events.length, 1);
	assert.deepEqual(events[0]?.trim().split(/\s+/u).slice(4), ['00:00:00:00', '00:00:00:27', '00:00:00:00', '00:00:00:27']);
	const warnings = report.items.filter(item => item.code === 'edl.speed-change-omitted'); assert.equal(warnings.length, frozen ? 1 : 0);
	if (frozen) {
		assert.equal(warnings[0]?.severity, 'warning'); assert.equal(warnings[0]?.disposition, 'omitted');
		assert.deepEqual(warnings[0]?.scope, { kind: 'clip', id: 'picture-0' });
		assert.deepEqual(warnings[0]?.data, { kind: 'video-retime', retimePoints: 2 });
	}
	assert.deepEqual(recipient.controller.getSnapshot().deliveryReport, report); assert.deepEqual(recipient.controller.project, before);
});
