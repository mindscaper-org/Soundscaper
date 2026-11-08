/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { stageTimelineInterchangeVideo, type TimelineInterchangeFinalizer } from '../src/common/editor/controller/import/internal/interchange/timeline-interchange-video.ts';
import { probeVideoTiming } from '../src/common/editor/video-timing-probe.ts';
import { registeredVideoTimingIndex } from '../src/common/editor/video-source-time.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import type { OwnedMediaAssetWriter } from '../src/common/editor/storage/media-asset-write-contract.ts';
import type { TimelineInterchangeDocument } from '../src/common/editor/timeline-interchange-types.ts';

function memoryStore() {
	const assets = new Map<string, { metadata: Readonly<Record<string, unknown>>; blob: Blob }>();
	return { assets,
		getMediaAssetMetadata: async (key: string) => assets.get(key)?.metadata ?? null,
		loadMediaAsset: async (key: string) => assets.get(key)?.blob ?? null,
		beginMediaAssetWrite: async (key: string, metadata: Readonly<Record<string, unknown>>, options: Readonly<{ expectedBytes: number; expectedSha256: string }>): Promise<OwnedMediaAssetWriter> => {
			let written = 0;
			const chunks: Uint8Array<ArrayBuffer>[] = [];
			const commit = async () => {
				const value = { metadata: { ...metadata, sha256: options.expectedSha256, size: written }, blob: new Blob(chunks) };
				assets.set(key, value);
				return { metadata: value.metadata, discardIfCurrent: async () => assets.get(key) === value ? assets.delete(key) : false };
			};
			return { maximumChunkBytes: 1024, get bytesWritten() { return written; },
				write: async bytes => { chunks.push(new Uint8Array(bytes)); written += bytes.length; },
				commit: async () => (await commit()).metadata, commitOwned: commit, abort: async () => undefined };
		},
	};
}

async function fixture() {
	const blob = new Blob(['original-video'], { type: 'video/webm' });
	const probe = await probeVideoTiming(blob, { probes: [{ id: 'fixture', async probe() { return {
		timescale: 1000, presentationTicks: [0n, 40n, 100n, 140n], finalFrameDurationTicks: 60n, nominalRate: { num: 25, den: 1 },
	}; } }] });
	const store = memoryStore(), finalizers: TimelineInterchangeFinalizer[] = [], stagedIds: string[] = [];
	let disposed = false;
	const request = { store, blob, sourceId: 'camera', sampleRate: 48000, reference: { id: 'media', kind: 'video' as const, name: 'camera.webm', path: 'camera.webm' },
		signal: new AbortController().signal, assertCurrent: () => undefined, preflightStorage: async () => undefined, finalizers, stagedIds };
	const ports = { probe: async () => probe, extract: async () => ({ metadata: { width: 320, height: 180, durationSeconds: 0.2 }, dispose: () => { disposed = true; } }) };
	return { request, ports, store, finalizers, stagedIds, disposed: () => disposed };
}

test('interchange video stages original bytes with digest-bound native VFR timing and maps source trims through its index', async () => {
	const fixtureValue = await fixture();
	const source = await stageTimelineInterchangeVideo(fixtureValue.request, fixtureValue.ports);
	assert.ok(source);
	assert.equal(source.contentHash, undefined);
	assert.match(String(source.contentSha256), /^[a-f\d]{64}$/u);
	assert.deepEqual(source.frameRate, { num: 25, den: 1 });
	assert.equal(source.sourceFrameCount, 4);
	assert.equal(source.sampleFrameCount, 9600);
	assert.deepEqual(fixtureValue.stagedIds, ['camera']);
	assert.equal(fixtureValue.disposed(), true);
	assert.ok(registeredVideoTimingIndex(source));
	const document: TimelineInterchangeDocument = { format: 'otio', title: 'Camera', sampleRate: 48000, rate: { num: 25, den: 1 }, dropFrame: false, startFrameCount: 0,
		issues: [], media: [fixtureValue.request.reference], tracks: [{ id: 'video', name: 'Video', kind: 'video', clips: [{ id: 'clip', name: 'Cut', mediaId: 'media', start: { num: 0, den: 1 }, sourceStart: { num: 1, den: 10 }, duration: { num: 1, den: 10 } }] }] };
	let next = 0;
	const project = createCurrentAudioEditorProject(buildTimelineInterchangeProject(document, { createStableId: prefix => `${prefix}-${++next}`, media: new Map([['media', source]]) }).project);
	assert.equal(project.clips[0]?.sourceInFrame, 2);
	assert.equal(project.clips[0]?.sourceFrameCount, 2);
	const extended = { ...document, tracks: document.tracks.map(track => ({ ...track, clips: track.clips.map(clip => ({ ...clip, duration: { num: 1, den: 5 } })) })) };
	const cropped = buildTimelineInterchangeProject(extended, { createStableId: prefix => `${prefix}-${++next}`, media: new Map([['media', source]]) });
	assert.equal(createCurrentAudioEditorProject(cropped.project).clips[0]?.sequenceFrameCount, 3);
	assert.ok(cropped.report.items.some(item => item.code === 'otio.clip-source-extent-converted'));
	for (const finalize of fixtureValue.finalizers) await finalize(true);
	assert.equal(registeredVideoTimingIndex(source), undefined);
	assert.equal(fixtureValue.store.assets.size, 2);
});

test('rollback releases the staging timing lease and removes only the newly published timing asset', async () => {
	const value = await fixture();
	const source = await stageTimelineInterchangeVideo(value.request, value.ports);
	assert.ok(source);
	for (const finalize of value.finalizers) await finalize(false);
	assert.equal(registeredVideoTimingIndex(source), undefined);
	assert.deepEqual([...value.store.assets.keys()], ['camera']);
});

test('unavailable exact video timing retains an offline reference without publishing guessed video', async () => {
	const value = await fixture();
	const fallback = await probeVideoTiming(value.request.blob);
	const source = await stageTimelineInterchangeVideo(value.request, { ...value.ports, probe: async () => fallback });
	assert.equal(source, null);
	assert.equal(value.store.assets.size, 0);
	assert.equal(value.finalizers.length, 0);
});
