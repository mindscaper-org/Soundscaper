/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { deterministicAvMedia } from './browser/fixtures/deterministic-av-media.js';
import { reviewedAvImportCustody } from './helpers/reviewed-av-import-custody.ts';
import { currentReviewedVideoProject } from './helpers/reviewed-video-project-custody.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { readWithReference, referenceItems } from './helpers/interchange-reference.ts';
import { loadVideoTimingAsset } from '../src/common/editor/video-timing-storage.ts';
import { unregisterVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { parseXmlDocument, walkXml } from '../src/common/editor/dawproject-xml.ts';
import { isDeliveryReport } from '../src/common/editor/delivery-report.ts';

function object(value: unknown): Record<string, unknown> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>;
}

function otioClips(text: string, kind: string): Record<string, unknown>[] {
	const document = object(JSON.parse(text)); assert.equal(document.OTIO_SCHEMA, 'Timeline.1');
	const tracks = object(document.tracks).children; assert.ok(Array.isArray(tracks));
	const track: unknown = tracks.find((track: unknown) => object(track).kind === kind); const children = object(track).children; assert.ok(Array.isArray(children));
	return children.map(object).filter(clip => clip.OTIO_SCHEMA === 'Clip.1');
}

test('one actual Opus AV import retains independent EDL/OTIO/FCPXML profiles through complete Scape and actual file transport', async context => {
	const media = deterministicAvMedia[0]; assert.ok(media);
	const fixture = await reviewedAvImportCustody(context, { name: 'interchange.webm', mimeType: media.file.mimeType,
		bytes: Uint8Array.from(media.file.buffer), sha256: media.sourceSha256 });
	const recipient = await fixture.reopen();
	const before = currentReviewedVideoProject(recipient.controller.project);
	const camera = before.sources.find(source => source.kind === 'video'), sound = before.sources.find(source => source.kind === 'audio');
	assert.ok(camera?.kind === 'video' && sound?.kind === 'audio');
	assert.equal(camera.sourceFrameCount, 32); assert.equal(camera.width, 96); assert.equal(camera.height, 54); assert.equal(camera.hasAudio, true);
	assert.equal(sound.sampleRate, 48_000); assert.equal(sound.channelCount, 2); assert.equal(sound.frameCount, 104_000);
	assert.deepEqual(before.clips.map(clip => clip.kind), ['video', 'audio']);
	const video = before.clips[0]; assert.ok(video?.kind === 'video'); assert.equal(video.sequenceFrameCount, 65);
	const decoded = await readCustodyPcm(recipient.environment.store, sound);
	assertPcmChannelsEqual(decoded, fixture.decoded.channels, 'every shipping Opus sample survives actual import and independent Scape');
	assert.ok(decoded[0]?.some(sample => Math.abs(sample) > .05));
	const body = await recipient.environment.store.loadMediaAsset(camera.storageKey); assert.ok(body instanceof Blob);
	assert.deepEqual(new Uint8Array(await body.arrayBuffer()), Uint8Array.from(media.file.buffer));
	const timing = await loadVideoTimingAsset(recipient.environment.store, camera.timingAsset, { sourceSha256: media.sourceSha256 });
	assert.equal(timing.status, 'available'); assert.equal(timing.index?.frameCount, 32); assert.equal(timing.index?.timescale, 1000);
	for (const [index, format] of ['edl', 'otio', 'fcpxml'].entries()) {
		unregisterVideoTimingIndex(camera);
		if (format === 'edl') await recipient.controller.actions.export.exportEdl();
		else if (format === 'otio') await recipient.controller.actions.export.exportOtio();
		else await recipient.controller.actions.export.exportFcpxml();
		assert.equal(fixture.saved.length, index + 1); const file = fixture.saved[index]; assert.ok(file); assert.ok(file.name.endsWith(`.${format}`));
		const text = await file.text();
		const report: unknown = recipient.controller.getSnapshot().deliveryReport; assert.ok(isDeliveryReport(report)); assert.equal(report.subject.format, format);
		if (format === 'edl') {
			assert.equal(file.type, 'text/plain'); assert.match(text, /^TITLE: Camera custody\nFCM: NON-DROP FRAME\n/u);
			assert.deepEqual(text.split('\n').filter(line => /^001\s/u.test(line)).map(line => line.trim().split(/\s+/u).slice(2)),
				[['V', 'C', '00:00:00:00', '00:00:02:05', '00:00:00:00', '00:00:02:05']]);
			const items = referenceItems(readWithReference(text, 'cmx_3600', { rate: 30 }, '.edl')); assert.equal(items.length, 1);
			assert.equal(items[0]?.startValue, 0); assert.equal(items[0]?.startRate, 30); assert.equal(items[0]?.durationValue, 65);
			const omissions = report.items.filter(item => item.code === 'edl.audio-track-omitted'); assert.equal(omissions.length, 1);
			const audioTrack = before.tracks.find(track => track.type === 'audio' && track.clipIds.length > 0); assert.ok(audioTrack?.type === 'audio');
			assert.deepEqual(omissions[0]?.scope, { kind: 'track', id: audioTrack.id });
			assert.deepEqual(omissions[0]?.data, { name: 'interchange Audio', clips: 1 });
			assert.equal(omissions[0]?.severity, 'warning'); assert.equal(omissions[0]?.disposition, 'omitted');
		} else if (format === 'otio') {
			assert.equal(file.type, 'application/json'); const picture = otioClips(text, 'Video'), audio = otioClips(text, 'Audio');
			assert.equal(picture.length, 1); assert.equal(audio.length, 1);
			assert.deepEqual(object(picture[0]?.source_range).start_time, { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 30 });
			assert.deepEqual(object(picture[0]?.source_range).duration, { OTIO_SCHEMA: 'RationalTime.1', value: 65, rate: 30 });
			assert.deepEqual(object(audio[0]?.source_range).duration, { OTIO_SCHEMA: 'RationalTime.1', value: 104_000, rate: 48_000 });
			const reference = object(picture[0]?.media_reference);
			assert.equal(reference.target_url, camera.storageKey);
			assert.equal(object(object(reference.metadata)['media.kw.soundscaper']).sourceName, 'interchange.webm');
			const items = referenceItems(readWithReference(text, 'otio_json', {}, '.otio')); assert.equal(items.length, 2);
		} else {
			assert.equal(file.type, 'application/xml'); const document = parseXmlDocument(text);
			const clips = [...walkXml(document)].filter(element => element.name === 'asset-clip'); assert.equal(clips.length, 2);
			assert.deepEqual(clips.map(clip => [clip.attributes.srcEnable, clip.attributes.start, clip.attributes.duration]), [['video', '0s', '13/6s'], ['audio', '0s', '13/6s']]);
			assert.ok(text.includes('interchange.webm'));
		}
		assert.deepEqual(recipient.controller.project, before, 'each profile leaves the entire admitted AV project unchanged');
		assert.deepEqual(await recipient.environment.store.loadProject(before.id), before);
	}
});
