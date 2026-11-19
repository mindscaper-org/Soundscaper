/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createProjectVisualService } from '../src/common/editor/controller/document/project-visual-service.ts';
import { createVideoTimingAssetPublication } from '../src/common/editor/video-timing-asset.ts';
import { demuxVideoTiming } from '../src/common/editor/video-timing-demux.ts';
import { sourceMonitorFragmentedMedia } from './browser/fixtures/video-timing-probe-media.js';

test('hybrid video activation shares a temporary picture URL while retaining the bin original', async () => {
	const fixture = sourceMonitorFragmentedMedia()[2]!;
	const original = new Blob([Uint8Array.from(fixture.buffer)], { type: fixture.mimeType });
	const sourceSha256 = createHash('sha256').update(fixture.buffer).digest('hex');
	const timing = await demuxVideoTiming(original);
	const publication = createVideoTimingAssetPublication(sourceSha256, timing);
	const source = {
		id: 'video', kind: 'video', contentSha256: sourceSha256, timingAsset: publication.reference,
	};
	const project = {
		id: 'project', schemaVersion: 1, sources: [source], tracks: [],
		clips: [{ id: 'video-clip', sourceId: source.id, kind: 'video' }],
		projectBin: { clips: [{ id: 'bin-video', sourceId: source.id, kind: 'video' }] },
	};
	const revoked: string[] = [];
	const blobs = new Map<string, Blob>();
	const service = createProjectVisualService({
		getProject: () => project,
		captureProject: id => id,
		assertProject: () => {},
		missingSourceIds: new Set(),
		sourceBuffers: new Map(),
		sourcePeaks: new Map(),
		waveformPcmWindows: new Map(),
		store: {
			listVideoDerivatives: async () => [],
			loadVideoDerivative: async () => null,
			loadMediaAsset: async (key) => key === publication.reference.storageKey
				? new Blob([Uint8Array.from(publication.bytes)]) : original,
		},
		projectDurationFrames: () => 1_000,
		url: {
			revokeObjectURL: url => { revoked.push(url); },
			createObjectURL(body) {
				const url = `blob:${blobs.size + 1}`;
				blobs.set(url, body);
				return url;
			},
		},
	});
	try {
		await service.activateVideoSource(source);
		const timelineUrl = service.getClipVisualData('video-clip')?.mediaUrl;
		const binUrl = service.getProjectBinClipVisualData('bin-video')?.mediaUrl;
		assert.ok(timelineUrl && binUrl);
		assert.notEqual(timelineUrl, binUrl);
		assert.equal(blobs.get(binUrl), original);
		const view = blobs.get(timelineUrl);
		assert.ok(view && view.size < original.size);
		const viewTiming = await demuxVideoTiming(view);
		assert.deepEqual(viewTiming.presentationTicks, timing.presentationTicks);
		assert.equal(viewTiming.finalFrameDurationTicks, timing.finalFrameDurationTicks);
		assert.equal(viewTiming.timescale, timing.timescale);
		assert.ok(viewTiming.characteristics && typeof viewTiming.characteristics === 'object'
			&& 'audioStreams' in viewTiming.characteristics);
		assert.deepEqual(viewTiming.characteristics.audioStreams, []);
		const monitor = service.getVideoSourceVisualData(source.id, { sourceMonitor: true });
		assert.equal(monitor?.mediaUrl, timelineUrl);
		assert.equal(monitor?.sourceMonitorBlob, undefined);
		await service.revokeVideoVisual(source.id);
		assert.deepEqual(new Set(revoked), new Set([binUrl, timelineUrl]));
		assert.equal(service.getClipVisualData('video-clip')?.mediaUrl, null);
	} finally {
		await service.dispose();
	}
});
