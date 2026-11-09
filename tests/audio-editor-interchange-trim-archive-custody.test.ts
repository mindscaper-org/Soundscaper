/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { loadVideoTimingAsset } from '../src/common/editor/video-timing-storage.ts';
import { acquireVideoTimingIndex, unregisterVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { readDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { deterministicSilentVideoMedia } from './browser/fixtures/deterministic-av-media.js';
import { reviewedVideoProjectCustody, currentReviewedVideoProject, type ReviewedVideoBytes } from './helpers/reviewed-video-project-custody.ts';

const media = deterministicSilentVideoMedia[0]; assert.ok(media);
const file: ReviewedVideoBytes = { name: 'trimmed-interchange.webm', mimeType: media.file.mimeType,
	bytes: Uint8Array.from(media.file.buffer), sha256: media.sourceSha256 };

for (const format of ['fcpxml', 'edl', 'otio', 'dawproject'] as const) test(`${format} retains actual native source PTS through controller trim, Scape and real file delivery`, async context => {
	const fixture = await reviewedVideoProjectCustody(context, [file], { num: 30, den: 1 });
	const initial = await fixture.verifyMedia(fixture.controller.project);
	const source = initial.sources[0]; assert.ok(source?.kind === 'video');
	const timing = await loadVideoTimingAsset(fixture.environment.store, source.timingAsset, { sourceSha256: file.sha256 });
	assert.equal(timing.status, 'available'); assert.equal(timing.index?.timescale, 1000);
	assert.equal(timing.index?.frameCount, 13); assert.equal(timing.index?.presentationTicks[6], 456n);
	fixture.controller.actions.timeline.selectClip('picture-0');
	await fixture.controller.actions.video.trim.commit({ activeClipId: 'picture-0', edge: 'left', requestedBoundarySample: 19_200 });
	await fixture.controller.actions.project.flush();
	const trimmed = currentReviewedVideoProject(fixture.controller.project);
	const clip = trimmed.clips[0]; assert.ok(clip?.kind === 'video'); assert.equal(clip.sourceInFrame, 6);
	const archive = createFramescaperScapeNativeRuntime(PROFILE);
	const delivered = await archive.exportScapeProject(trimmed, fixture.environment.store); assert.ok(delivered.blob);
	const files: File[] = [];
	const recipient = await reviewedVideoProjectCustody(context, [], { num: 30, den: 1 }, { fileService: {
		...createAudioEditorFileService(), async saveFile(request: unknown) {
			assert.ok(request && typeof request === 'object');
			const blob = Reflect.get(request, 'blob'); assert.ok(blob instanceof Blob);
			const name = Reflect.get(request, 'suggestedName'); assert.equal(typeof name, 'string');
			files.push(new File([blob], name, { type: blob.type })); return { method: 'node-fixture', fileName: name, size: blob.size };
		},
	} });
	await recipient.controller.actions.project.openScapeFile(new File([delivered.blob], 'Trimmed.fscape'), () => 'copy');
	const reopened = currentReviewedVideoProject(recipient.controller.project);
	assert.deepEqual(reopened.clips, trimmed.clips); assert.deepEqual(reopened.sources, trimmed.sources);
	const retained = reopened.sources[0]; assert.ok(retained?.kind === 'video');
	const body = await recipient.environment.store.loadMediaAsset(retained.storageKey); assert.ok(body instanceof Blob);
	assert.deepEqual(new Uint8Array(await body.arrayBuffer()), file.bytes);
	const recipientTiming = await loadVideoTimingAsset(recipient.environment.store, retained.timingAsset, { sourceSha256: file.sha256 });
	assert.equal(recipientTiming.status, 'available'); assert.equal(recipientTiming.index?.presentationTicks[6], 456n);
	// Require the export owner to load its own persisted clock, not an earlier controller's cache.
	unregisterVideoTimingIndex(retained);
	// DAWproject consumes a hydrated source lease; its retained native workflow
	// owns that integration. The index here is authenticated from the recipient store.
	const lease = format === 'dawproject' && recipientTiming.index ? acquireVideoTimingIndex(retained, recipientTiming.index) : null;
	try {
		if (format === 'fcpxml') await recipient.controller.actions.export.exportFcpxml();
		else if (format === 'edl') await recipient.controller.actions.export.exportEdl();
		else if (format === 'otio') await recipient.controller.actions.export.exportOtio();
		else await recipient.controller.actions.project.saveDawproject();
	} finally { lease?.release(); }
	assert.equal(files.length, 1); const output = files[0]; assert.ok(output);
	assert.match(output.name, new RegExp(`\\.${format}$`, 'u'));
	const text = await output.text();
	if (format === 'fcpxml') assert.equal(/<asset-clip[^>]*\bstart="([^"]+)"/u.exec(text)?.[1], '57/125s');
	else if (format === 'edl') assert.equal(text.split('\n').find(line => /^001\s/u.test(line))?.trim().split(/\s+/u)[4], '00:00:00:14');
	else if (format === 'otio') {
		const timeline: unknown = JSON.parse(text);
		assert.ok(timeline && typeof timeline === 'object');
		const tracks: unknown = Reflect.get(timeline, 'tracks'); assert.ok(tracks && typeof tracks === 'object');
		const children: unknown = Reflect.get(tracks, 'children'); assert.ok(Array.isArray(children));
		const video: unknown = children.find(track => track.kind === 'Video'); assert.ok(video && typeof video === 'object');
		const clips: unknown = Reflect.get(video, 'children'); assert.ok(Array.isArray(clips));
		const exported: unknown = clips.find(clip => clip.OTIO_SCHEMA === 'Clip.1'); assert.ok(exported && typeof exported === 'object');
		const range: unknown = Reflect.get(exported, 'source_range'); assert.ok(range && typeof range === 'object');
		assert.deepEqual(Reflect.get(range, 'start_time'), { OTIO_SCHEMA: 'RationalTime.1', value: 13.68, rate: 30 });
	} else {
		const document = await readDawprojectArchive(output);
		try { assert.equal(/<Clip[^>]*\bplayStart="([^"]+)"/u.exec(document.projectXml)?.[1], '0.456'); }
		finally { await document.close(); }
	}
});
