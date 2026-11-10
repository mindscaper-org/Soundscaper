/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { deterministicAvMedia } from './browser/fixtures/deterministic-av-media.js';
import { reviewedAvImportCustody } from './helpers/reviewed-av-import-custody.ts';
import { currentReviewedVideoProject } from './helpers/reviewed-video-project-custody.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { loadVideoTimingAsset } from '../src/common/editor/video-timing-storage.ts';
import { unregisterVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { parseXmlDocument, type XmlElement } from '../src/common/editor/dawproject-xml.ts';

function elements(element: XmlElement, name: string): readonly XmlElement[] {
	return [...(element.name === name ? [element] : []), ...element.children.flatMap(child => elements(child, name))];
}

for (const removeAudio of [false, true]) test(`actual Opus AV import and FCPXML retain physical component custody removedAudio=${removeAudio}`, async context => {
	const media = deterministicAvMedia[0]; assert.ok(media);
	const fixture = await reviewedAvImportCustody(context, { name: 'camera.webm', mimeType: media.file.mimeType,
		bytes: Uint8Array.from(media.file.buffer), sha256: media.sourceSha256 });
	const project = currentReviewedVideoProject(fixture.controller.project);
	assert.equal(project.sources.length, 2); assert.equal(project.clips.length, 2);
	const audioSource = project.sources.find(source => source.kind === 'audio'); assert.ok(audioSource?.kind === 'audio');
	const videoSource = project.sources.find(source => source.kind === 'video'); assert.ok(videoSource?.kind === 'video');
	assert.equal(videoSource.hasAudio, true); assert.equal(videoSource.audioCodec, 'opus');
	assert.equal(videoSource.width, 96); assert.equal(videoSource.height, 54); assert.equal(videoSource.sourceFrameCount, 32);
	assert.equal(audioSource.sampleRate, 48_000); assert.equal(audioSource.channelCount, 2); assert.equal(audioSource.frameCount, 104_000);
	assert.equal(audioSource.opaqueExtensions.originVideoSourceId, videoSource.id);
	assert.equal(fixture.decoded.sampleRate, 48_000); assert.equal(fixture.decoded.channels.length, 2);
	assert.equal(fixture.decoded.channels[0]?.length, 104_000);
	const samples = await readCustodyPcm(fixture.environment.store, audioSource);
	assertPcmChannelsEqual(samples, fixture.decoded.channels, 'every original Opus-decoded sample reaches actual source storage');
	assert.ok(samples[0]?.some(sample => Math.abs(sample) > .05));
	const picture = project.clips.find(clip => clip.kind === 'video'), sound = project.clips.find(clip => clip.kind === 'audio');
	assert.ok(picture?.kind === 'video' && sound?.kind === 'audio');
	assert.ok(picture.avLinkId); assert.equal(picture.avLinkId, sound.avLinkId);
	assert.equal(sound.durationFrames, 104_000); assert.equal(picture.sequenceFrameCount, 65);
	if (removeAudio) {
		fixture.controller.actions.edit.commit({ type: 'clip/unlink-av', clipId: picture.id });
		fixture.controller.actions.clip.remove(sound.id);
		const removed = currentReviewedVideoProject(fixture.controller.project);
		assert.equal(removed.clips.length, 1); assert.equal(removed.clips[0]?.avLinkId, null);
		await fixture.controller.actions.edit.undo(); await fixture.controller.actions.edit.undo();
		assert.deepEqual(fixture.controller.project?.clips, project.clips); assert.deepEqual(fixture.controller.project?.tracks, project.tracks);
		await fixture.controller.actions.edit.redo(); await fixture.controller.actions.edit.redo();
		assert.deepEqual(fixture.controller.project?.clips, removed.clips); assert.deepEqual(fixture.controller.project?.tracks, removed.tracks);
	}
	const recipient = await fixture.reopen();
	assert.equal(recipient.project.clips.filter(clip => clip.kind === 'audio').length, removeAudio ? 0 : 1);
	assert.equal(recipient.project.clips.filter(clip => clip.kind === 'video').length, 1);
	const camera = recipient.project.sources.find(source => source.id === videoSource.id); assert.ok(camera?.kind === 'video');
	assert.equal(camera.hasAudio, true, 'original camera metadata still describes its real encoded audio track');
	const blob = await recipient.environment.store.loadMediaAsset(camera.storageKey); assert.ok(blob instanceof Blob);
	assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), Uint8Array.from(media.file.buffer));
	const clock = await loadVideoTimingAsset(recipient.environment.store, camera.timingAsset, { sourceSha256: media.sourceSha256 });
	assert.equal(clock.status, 'available'); assert.equal(clock.index?.timescale, 1000); assert.equal(clock.index?.frameCount, 32);
	const restoredAudio = recipient.project.sources.find(source => source.id === audioSource.id);
	if (restoredAudio) { assert.ok(restoredAudio.kind === 'audio'); assertPcmChannelsEqual(await readCustodyPcm(recipient.environment.store, restoredAudio), fixture.decoded.channels, 'every decoded sample survives fresh AV Scape'); }
	if (!removeAudio) assert.ok(restoredAudio);
	unregisterVideoTimingIndex(camera);
	await recipient.controller.actions.export.exportFcpxml();
	const output = fixture.saved[0]; assert.ok(output); assert.match(output.name, /\.fcpxml$/u);
	const document = parseXmlDocument(await output.text());
	const assets = new Map(elements(document, 'asset').map(asset => [asset.attributes.id, asset.attributes]));
	const clips = elements(document, 'asset-clip'); assert.equal(clips.length, removeAudio ? 1 : 2);
	const components = clips.map(clip => {
		const asset = assets.get(clip.attributes.ref); assert.ok(asset);
		return { video: asset.hasVideo === '1' && clip.attributes.srcEnable !== 'audio', audio: asset.hasAudio === '1' && clip.attributes.srcEnable !== 'video' };
	});
	assert.equal(components.filter(component => component.video).length, 1);
	assert.equal(components.filter(component => component.audio).length, removeAudio ? 0 : 1);
	assert.equal(clips[0]?.attributes.srcEnable, 'video');
	assert.equal(assets.get(clips[0]!.attributes.ref)?.hasAudio, '1');
	if (!removeAudio) assert.equal(clips[1]?.attributes.srcEnable, 'audio');
});
