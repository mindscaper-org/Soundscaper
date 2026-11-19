/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createAudioEditorFileService } from '../../src/common/editor/file-service.js';
import { isDeliveryReport } from '../../src/common/editor/delivery-report.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import type { FramescaperMulticameraActionsSequence } from '../../src/framescaper/editor-project-sequence-multicam-actions.ts';
import type { FramescaperVideoRetimeActionsRetime } from '../../src/framescaper/editor-project-retime-retime-actions.ts';
import { videoTimingProbeMedia } from '../browser/fixtures/video-timing-probe-media.js';
import { videoSourceGeometryMedia } from '../browser/fixtures/video-source-geometry-media.js';
import { deterministicSilentVideoMedia } from '../browser/fixtures/deterministic-av-media.js';
import { reviewedVideoProjectCustody, currentReviewedVideoProject, type ReviewedVideoBytes } from './reviewed-video-project-custody.ts';

export const reviewedCameraFiles: readonly ReviewedVideoBytes[] = [videoTimingProbeMedia.find(media => media.id === 'cfr-25fps-mp4-v1'),
	videoSourceGeometryMedia.find(media => media.id === 'geometry-anamorphic-mp4-v1')].map((media, index) => {
	assert.ok(media); return { name: `camera-${index}.mp4`, mimeType: media.file.mimeType,
		bytes: Uint8Array.from(media.file.buffer), sha256: media.sourceSha256 };
});
const webm = deterministicSilentVideoMedia[0]; assert.ok(webm);
export const reviewedSilentWebm: ReviewedVideoBytes = { name: 'Camera.webm', mimeType: webm.file.mimeType,
	bytes: Uint8Array.from(webm.file.buffer), sha256: webm.sourceSha256 };

/** Actual native-picture admission stays in retained browser workflows; every subsequent owner is real. */
export async function reviewedVideoReportCustody(context: TestContext, files: readonly ReviewedVideoBytes[], rate = { num: 25, den: 1 }) {
	const saved: File[] = [];
	const presentation = { fileService: { ...createAudioEditorFileService(), async saveFile(value: unknown) {
		assert.ok(value && typeof value === 'object');
		const blob = Reflect.get(value, 'blob'); assert.ok(blob instanceof Blob);
		const name = Reflect.get(value, 'suggestedName'); assert.ok(typeof name === 'string');
		saved.push(new File([blob], name, { type: blob.type }));
		return { method: 'node-fixture', fileName: name, size: blob.size };
	} } };
	const fixture = await reviewedVideoProjectCustody(context, files, rate, presentation);
	return { ...fixture, saved, async reopen() {
		await fixture.controller.actions.project.flush();
		const project = await fixture.verifyMedia(fixture.controller.project);
		assert.deepEqual(currentReviewedVideoProject(await fixture.environment.store.loadProject(project.id)), project);
		const archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, fixture.environment.store);
		assert.ok(archive.blob);
		const recipient = await reviewedVideoProjectCustody(context, [], rate, presentation);
		await recipient.controller.actions.project.openScapeFile(new File([archive.blob], 'Report.fscape'), () => 'copy');
		const reopened = await fixture.verifyMedia(recipient.controller.project, recipient.environment.store);
		assert.deepEqual(reopened.sources, project.sources); assert.deepEqual(reopened.clips, project.clips);
		assert.deepEqual(reopened.tracks, project.tracks); assert.deepEqual(reopened.sequences, project.sequences);
		assert.deepEqual(reopened.multicameraGroups, project.multicameraGroups);
		return { ...recipient, project: reopened };
	} };
}

type ReportSequenceActions = FramescaperMulticameraActionsSequence & Readonly<{ retimeFreeze: FramescaperVideoRetimeActionsRetime['freeze'] }>;
function isReportSequenceActions(value: unknown): value is ReportSequenceActions {
	return value !== null && typeof value === 'object'
		&& ['createMulticamera', 'updateMulticamera', 'removeMulticamera', 'switchMulticamera', 'retimeFreeze']
			.every(name => typeof Reflect.get(value, name) === 'function');
}
export function reportSequenceActions(value: unknown): ReportSequenceActions {
	assert.ok(isReportSequenceActions(value), 'the real product controller must supply its composed multicamera/retime actions');
	return value;
}

export function deliveredVideoReport(value: unknown) {
	assert.ok(value && typeof value === 'object');
	const report: unknown = Reflect.get(value, 'report'); assert.ok(isDeliveryReport(report));
	return report;
}

export function otioVideoClips(text: string): Readonly<Record<string, unknown>>[] {
	const document: unknown = JSON.parse(text); assert.ok(document && typeof document === 'object');
	const tracks: unknown = Reflect.get(document, 'tracks'); assert.ok(tracks && typeof tracks === 'object');
	const children: unknown = Reflect.get(tracks, 'children'); assert.ok(Array.isArray(children));
	return children.filter((track: unknown): track is Readonly<Record<string, unknown>> => Boolean(track && typeof track === 'object' && Reflect.get(track, 'kind') === 'Video'))
		.flatMap(track => { const children: unknown = track.children; assert.ok(Array.isArray(children));
			return children.filter((clip: unknown): clip is Readonly<Record<string, unknown>> => Boolean(clip && typeof clip === 'object' && Reflect.get(clip, 'OTIO_SCHEMA') === 'Clip.1')); });
}
