/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import type { FramescaperMulticameraActionsSequence } from '../src/framescaper/editor-project-sequence-multicam-actions.ts';
import { validateFramescaperMulticameraGroupsSequence } from '../src/framescaper/editor-project-sequence-multicam.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { videoTimingProbeMedia } from './browser/fixtures/video-timing-probe-media.js';
import { videoSourceGeometryMedia } from './browser/fixtures/video-source-geometry-media.js';
import { reviewedVideoProjectCustody, currentReviewedVideoProject, type ReviewedVideoBytes } from './helpers/reviewed-video-project-custody.ts';

const files: readonly ReviewedVideoBytes[] = [videoTimingProbeMedia.find(media => media.id === 'cfr-25fps-mp4-v1'),
	videoSourceGeometryMedia.find(media => media.id === 'geometry-anamorphic-mp4-v1')].map((media, index) => {
	assert.ok(media); return { name: `camera-${index}.mp4`, mimeType: media.file.mimeType,
		bytes: Uint8Array.from(media.file.buffer), sha256: media.sourceSha256 };
});

for (const [mode, grouped] of [['duplicate', false], ['duplicate', true], ['archive copy', true]] as const) test(`real ${mode} grouped=${grouped} retains camera ownership, media and portable reopening`, async context => {
	const fixture = await reviewedVideoProjectCustody(context, files);
	const { controller } = fixture;
	const multicamera = multicameraActions(controller.actions.sequences);
	if (grouped) {
		const current = currentReviewedVideoProject(controller.project);
		multicamera.createMulticamera(current.id, current.revision, { id: 'ensemble', projectId: current.id, sequenceId: 'main',
			outputClipId: 'picture-0', activeMemberId: 'front', members: [
				{ id: 'front', groupId: 'ensemble', sourceId: 'camera-0', syncOffsetSamples: 0 },
				{ id: 'side', groupId: 'ensemble', sourceId: 'camera-1', syncOffsetSamples: 0 },
			] });
	}
	await controller.actions.project.flush();
	const original = await fixture.verifyMedia(controller.project);
	const archive = createFramescaperScapeNativeRuntime(PROFILE);
	if (mode === 'duplicate') await controller.actions.project.duplicate(undefined);
	else {
		const saved = await archive.exportScapeProject(original, fixture.environment.store); assert.ok(saved.blob);
		await controller.actions.project.openScapeFile(new File([saved.blob], 'Cameras.fscape'), () => 'copy');
	}
	const copied = await fixture.verifyMedia(controller.project);
	assert.notEqual(copied.id, original.id); assert.match(copied.title, /copy/iu);
	assert.equal(copied.clips.length, 2);
	assert.deepEqual(copied.sources.map(source => [source.name, source.contentSha256, source.kind === 'video' ? source.sourceFrameCount : 0]),
		[['camera-0.mp4', files[0]!.sha256, 22], ['camera-1.mp4', files[1]!.sha256, 22]]);
	assert.deepEqual(copied.sources.map(sourcePayload), original.sources.map(sourcePayload));
	assert.deepEqual(currentReviewedVideoProject(await fixture.environment.store.loadProject(original.id)), original);
	const groups = validateFramescaperMulticameraGroupsSequence(PROFILE, copied, copied.multicameraGroups);
	assert.equal(groups.length, grouped ? 1 : 0);
	let switchedMember = '';
	if (grouped) {
		const group = groups[0]; assert.ok(group);
		assert.equal(group.projectId, copied.id); assert.equal(group.sequenceId, copied.primarySequenceId);
		const output = copied.clips.find(clip => clip.id === group.outputClipId); assert.ok(output?.kind === 'video');
		assert.equal(copied.sources.find(source => source.id === output.sourceId)?.name, 'camera-0.mp4');
		assert.deepEqual(group.members.map(member => [member.groupId, copied.sources.find(source => source.id === member.sourceId)?.name, member.syncOffsetSamples]),
			[[group.id, 'camera-0.mp4', 0], [group.id, 'camera-1.mp4', 0]]);
		assert.equal(group.members.find(member => member.id === group.activeMemberId)?.sourceId, output.sourceId);
		switchedMember = group.members.find(member => copied.sources.find(source => source.id === member.sourceId)?.name === 'camera-1.mp4')!.id;
		multicamera.switchMulticamera(copied.id, copied.revision, group.id, group.activeMemberId, switchedMember);
	}
	await controller.actions.project.flush();
	const expected = currentReviewedVideoProject(controller.project);
	const delivered = await archive.exportScapeProject(expected, fixture.environment.store); assert.ok(delivered.blob);
	const recipient = await reviewedVideoProjectCustody(context, []);
	await recipient.controller.actions.project.openScapeFile(new File([delivered.blob], 'Independent.fscape'), () => 'copy');
	const reopened = currentReviewedVideoProject(recipient.controller.project);
	assert.equal(reopened.id, copied.id); assert.equal(reopened.clips.length, 2);
	assert.deepEqual(reopened.sources, expected.sources); assert.deepEqual(reopened.multicameraGroups, expected.multicameraGroups);
	if (grouped) assert.equal(validateFramescaperMulticameraGroupsSequence(PROFILE, reopened, reopened.multicameraGroups)[0]?.activeMemberId, switchedMember);
	for (const file of files) {
		const source = reopened.sources.find(source => source.name === file.name); assert.ok(source?.kind === 'video');
		const body = await recipient.environment.store.loadMediaAsset(source.storageKey); assert.ok(body instanceof Blob);
		assert.deepEqual(new Uint8Array(await body.arrayBuffer()), file.bytes);
	}
});

function sourcePayload(source: Readonly<Record<string, unknown>>) {
	return Object.fromEntries(Object.entries(source).filter(([key]) => key !== 'id' && key !== 'storageKey'));
}
function isMulticameraActions(value: unknown): value is FramescaperMulticameraActionsSequence {
	return value !== null && typeof value === 'object' && ['createMulticamera', 'updateMulticamera', 'removeMulticamera', 'switchMulticamera']
		.every(name => typeof Reflect.get(value, name) === 'function');
}
function multicameraActions(value: unknown): FramescaperMulticameraActionsSequence {
	assert.ok(isMulticameraActions(value), 'the actual product controller must expose its complete composed multicamera action port');
	return value;
}
