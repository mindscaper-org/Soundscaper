/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { resolveVideoSourcePropertiesView } from '../src/common/editor/source-properties-model.ts';
import { loadVideoTimingAsset } from '../src/common/editor/video-timing-storage.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { currentReviewedVideoProject } from './helpers/reviewed-video-project-custody.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createDeterministicSilentVideoFixture } from './browser/fixtures/deterministic-av-media.js';
import { webmSourceFactsCustody } from './helpers/framescaper-webm-source-facts-custody.ts';

function authored(value: unknown) {
	const { revision: _revision, updatedAt: _updatedAt, selection: _selection, ...document } = currentReviewedVideoProject(value);
	return document;
}

test('real Bin import owns ordinary and reordered WebM facts, exact timing, history and one fresh Scape', async context => {
	const fixture = createDeterministicSilentVideoFixture('Reordered camera.webm');
	const ordinary = fixture.buffer;
	assert.equal(createHash('sha256').update(ordinary).digest('hex'), '54a2143e3ae4d634c5f862cfe672a0d222d7f5155bb95455a41c3cc20de3caa0');
	// Exactly the original browser's complete Video-element move; packet/cue offsets stay fixed.
	const entry = ordinary.indexOf(Buffer.from([0xae, 0xa7, 0xd7]));
	const type = ordinary.indexOf(Buffer.from([0x83, 0x81, 0x01]), entry);
	const video = ordinary.indexOf(Buffer.from([0xe0, 0x8a]), type);
	assert.ok(entry > 0 && type > entry && video > type);
	const reordered = Buffer.concat([ordinary.subarray(0, type), ordinary.subarray(video, video + 12), ordinary.subarray(type, video), ordinary.subarray(video + 12)]);
	assert.equal(reordered.length, ordinary.length); assert.notDeepEqual(reordered, ordinary);
	assert.deepEqual(reordered.subarray(video + 12), ordinary.subarray(video + 12));
	const editor = await webmSourceFactsCustody(context);
	const ids: string[] = [], inputs = [ordinary, reordered];
	const initialEntries = editor.controller.getSnapshot().history.undoEntries.length;
	let afterFirst: unknown;
	for (const [index, bytes] of inputs.entries()) {
		const result = await editor.importVideo(new File([Uint8Array.from(bytes)], fixture.name, { type: fixture.mimeType }));
		assert.deepEqual([result.destination, result.audioSourceId, result.audioClipId, result.trackId, result.notice], ['project-bin', null, null, null, undefined]);
		ids.push(result.sourceId);
		const project = currentReviewedVideoProject(editor.controller.project);
		assert.equal(project.sources.length, index + 1); assert.equal(project.clips.length, 0); assert.equal(project.tracks.length, 0);
		const clips = project.projectBin.clips; assert.equal(clips.length, index + 1);
		const clip = clips.find(clip => clip.id === result.clipId); assert.ok(clip?.kind === 'video');
		assert.deepEqual([clip.sourceId, clip.title, clip.sourceInFrame, clip.sourceFrameCount], [result.sourceId, 'Reordered camera', 0, 13]);
		assert.ok(clip.binItemId);
		assert.equal(editor.controller.getSnapshot().history.undoEntries.length, initialEntries + index + 1);
		if (index === 0) afterFirst = project;
	}
	const applied = currentReviewedVideoProject(editor.controller.project);
	const verify = async (value: unknown, store: Pick<typeof editor.environment.store, 'loadMediaAsset'>) => {
		const project = currentReviewedVideoProject(value);
		assert.equal(project.sources.length, 2);
		for (const [index, id] of ids.entries()) {
			const source = project.sources.find(source => source.id === id); assert.ok(source?.kind === 'video');
			const bytes = inputs[index]; assert.ok(bytes);
			const digest = createHash('sha256').update(bytes).digest('hex');
			assert.deepEqual([source.name, source.mimeType, source.width, source.height, source.sourceFrameCount,
				source.sampleRate, source.sampleFrameCount, source.hasAudio, source.audioCodec, source.contentSha256],
			[fixture.name, 'video/webm', 96, 54, 13, 48_000, 43_872, false, null, digest]);
			const view = resolveVideoSourcePropertiesView(source);
			assert.equal(view.videoCodec, 'vp8');
			assert.deepEqual([view.characteristics.codedWidth, view.characteristics.codedHeight, view.characteristics.hasAlpha], [96, 54, true]);
			assert.deepEqual([view.timingMode, view.timingBackend], ['exact', 'container']);
			const media = await store.loadMediaAsset(source.storageKey); assert.ok(media instanceof Blob);
			assert.deepEqual(new Uint8Array(await media.arrayBuffer()), Uint8Array.from(bytes));
			const timing = await loadVideoTimingAsset(store, source.timingAsset, { sourceSha256: digest });
			assert.equal(timing.status, 'available'); assert.ok(timing.index);
			// Pinned fixture's thirteen genuine packet timestamps; no CFR180 declaration or fabricated frames.
			assert.deepEqual([timing.index.timescale, timing.index.presentationTicks, timing.index.finalFrameDurationTicks, timing.index.endTicks],
				[1000, [0n, 65n, 195n, 260n, 326n, 391n, 456n, 521n, 587n, 652n, 717n, 782n, 848n], 66n, 914n]);
		}
	};
	await verify(applied, editor.environment.store);
	await editor.controller.actions.edit.undo(); assert.deepEqual(authored(editor.controller.project), authored(afterFirst));
	await editor.controller.actions.project.flush();
	assert.deepEqual(await editor.environment.store.loadProject(applied.id), editor.controller.project);
	await editor.controller.actions.edit.redo(); assert.deepEqual(authored(editor.controller.project), authored(applied));
	await editor.controller.actions.project.flush();
	const current = currentReviewedVideoProject(editor.controller.project);
	assert.deepEqual(await editor.environment.store.loadProject(current.id), current);
	const archive = createFramescaperScapeNativeRuntime(PROFILE);
	const exported = await archive.exportScapeProject(current, editor.environment.store); assert.ok(exported.blob);
	const recipient = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	try {
		const reopened = await archive.importScapeProject(exported.blob, recipient);
		assert.equal(reopened.readOnly, false); assert.deepEqual(reopened.project, current);
		assert.deepEqual(await recipient.loadProject(current.id), current);
		await verify(reopened.project, recipient);
	} finally { await recipient.close(); }
	assert.deepEqual(editor.nativeCalls, []);
});
