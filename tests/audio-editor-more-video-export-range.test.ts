/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorVideoExportAction } from '../src/common/editor/controller/export/internal/video/video-export-service.ts';
import { createProjectVisualService } from '../src/common/editor/controller/document/project-visual-service.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import { createVideoTimingAssetPublication } from '../src/common/editor/video-timing-asset.ts';
import { createFixture } from './helpers/export-service-fixture.ts';

for (const missing of ['original', 'timing'] as const) {
	test(`MI18: movie selection export needs no ${missing} asset from a later clip outside the delivered range`, async () => {
		const digest = 'ab'.repeat(32);
		const timing = createVideoTimingAssetPublication(digest, { timescale: 30,
			presentationTicks: Array.from({ length: 30 }, (_, index) => BigInt(index)), finalFrameDurationTicks: 1n });
		const sources = ['healthy', 'offline'].map(id => createVideoSource({ id, name: `${id}.mp4`, storageKey: `${id}.mp4`,
			contentSha256: digest, sampleFrameCount: 48_000, sourceFrameCount: 30,
			frameRate: { num: 30, den: 1 }, width: 320, height: 180,
			...(id === 'offline' && missing === 'timing'
				? { timingAsset: timing.reference, timingDecision: { mode: 'exact', rate: { num: 30, den: 1 } } } : {}) }));
		const project = createSoundscaperProject({ id: 'selection-movie', sampleRate: 48_000, sources,
			primarySequenceId: 'main', sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['picture'] }],
			tracks: [{ id: 'picture', type: 'video', clipIds: ['healthy-clip', 'offline-clip'] }],
			selection: { startFrame: 0, endFrame: 48_000, trackIds: [], clipIds: [] },
			clips: sources.map((source, index) => ({ id: `${source.id}-clip`, kind: 'video', title: source.id,
				sourceId: source.id, sequenceId: 'main', sequenceStartFrame: index * 300,
				sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 })),
		});
		const fixture = createFixture();
		const reads: string[] = [];
		const store = { loadMediaAsset: async (key: string) => { reads.push(key); return key === 'healthy.mp4' ? new Blob(['video']) : null; },
			listVideoDerivatives: async () => [], loadVideoDerivative: async () => null };
		const visuals = createProjectVisualService({ getProject: () => project,
			captureProject: () => undefined, assertProject: () => undefined,
			missingSourceIds: new Set(missing === 'original' ? ['offline'] : []), sourceBuffers: new Map(),
			sourcePeaks: new Map(), waveformPcmWindows: new Map(), store,
			projectDurationFrames: () => 528_000, url: { createObjectURL: () => 'blob:unused', revokeObjectURL: () => undefined } });
		const exporting = createEditorVideoExportAction({ ...fixture.runtime, getProject: () => project, store,
			hasMissingTimelineSources: visuals.hasMissingTimelineSources, createVideoExportPlan,
			fileService: { isDesktop: true, getDesktopVideoExportCapabilities: async () => ({ schemaVersion: 1,
				formats: { mp4: { available: true, provider: 'external-ffmpeg' }, webm: { available: true, provider: 'external-ffmpeg' } } }),
				createDownload: async () => ({ url: 'blob:movie', fileName: 'Selection.mp4', method: 'memory' }) },
		}, async () => { throw new Error('This movie has no audio'); });
		const result: unknown = await exporting({ range: 'selection' });
		assert.deepEqual(fixture.errors, []);
		assert.ok(result);
		assert.deepEqual(reads, ['healthy.mp4']);
		if (missing === 'original') await assert.rejects(exporting({ range: 'project' }), /missing|local/iu);
		else {
			assert.equal(await exporting({ range: 'project' }), null);
			assert.match(String(fixture.errors.at(-1)), /timing asset.*missing/iu);
		}
	});
}
