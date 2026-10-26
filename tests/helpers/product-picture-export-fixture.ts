/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';

import { createEditorVideoExportAction } from '../../src/common/editor/controller/export/internal/video/video-export-service.ts';
import type {
	ProductVideoExportPlan,
	ProductVideoExportStrategy,
	ProductVideoExportStrategyEncodeRequest,
	ProductVideoExportStrategyPlanRequest,
} from '../../src/common/editor/controller/export/product-video-export-strategy.ts';
import { createFixture as createExportServiceFixture } from './export-service-fixture.ts';

const SAMPLE_RATE = 48_000;

export function createPictureOnlyFixture(kind: 'still' | 'generator', withAudio: boolean, reportedAudio?: boolean) {
	const fixture = createExportServiceFixture();
	const pictureClip = Object.freeze({
		id: `${kind}-clip`, kind, sourceId: `${kind}-source`,
		timelineStartFrame: 0, durationFrames: SAMPLE_RATE,
	});
	const audioClip = Object.freeze({
		id: 'audio-clip', kind: 'audio', sourceId: 'audio-source',
		timelineStartFrame: 0, durationFrames: SAMPLE_RATE,
	});
	const project = Object.freeze({
		id: `picture-${kind}`, title: `Picture ${kind}`,
		sampleRate: SAMPLE_RATE, masterChannels: 2,
		tracks: Object.freeze([
			Object.freeze({
				id: 'picture-track', type: 'video', hidden: false,
				clipIds: Object.freeze([pictureClip.id]),
			}),
			...(withAudio ? [Object.freeze({
				id: 'audio-track', type: 'audio', clipIds: Object.freeze([audioClip.id]),
			})] : []),
		]),
		clips: Object.freeze([pictureClip, ...(withAudio ? [audioClip] : [])]),
		sources: Object.freeze([Object.freeze({ id: `${kind}-source`, kind })]),
	});
	const capture: {
		timingSourceIds?: readonly string[];
		videoBlobIds?: readonly string[];
		includeAudio?: boolean;
		audioMix?: Blob | null;
	} = {};
	const plan: ProductVideoExportPlan = Object.freeze({
		version: 13, format: 'mp4', extension: 'mp4', mimeType: 'video/mp4', sampleRate: SAMPLE_RATE, quality: 'balanced',
		range: Object.freeze({ startFrame: 0, endFrame: SAMPLE_RATE, durationFrames: SAMPLE_RATE }),
		canvas: Object.freeze({
			width: 640, height: 360, frameRate: Object.freeze({ num: 1, den: 1 }),
			fit: 'contain', pixelFormat: 'yuv420p', backgroundColor: '#000000',
		}),
		inputs: Object.freeze(withAudio ? [Object.freeze({
			kind: 'staged-audio-mix', channelLayout: 'preserve',
		})] : []),
		activeSourceIds: Object.freeze([]),
	});
	const strategy: ProductVideoExportStrategy = Object.freeze({
		createExportProject: () => project,
		hasPicture: (candidate: Readonly<Record<string, unknown>>) => candidate === project,
		...(reportedAudio === undefined ? {} : { hasAudio: () => reportedAudio }),
		createPlan(request: ProductVideoExportStrategyPlanRequest) {
			capture.includeAudio = request.includeAudio;
			return plan;
		},
		captureTimingSourceIds(candidate: ProductVideoExportPlan) {
			assert.strictEqual(candidate, plan);
			capture.timingSourceIds = candidate.activeSourceIds;
			return [];
		},
		async encode(request: ProductVideoExportStrategyEncodeRequest) {
			capture.videoBlobIds = [...request.videoBlobs.keys()];
			capture.audioMix = request.audioMix;
			return Object.freeze({
				bytes: Uint8Array.of(1, 2, 3, 4), byteLength: 4,
				extension: '.mp4' as const, mimeType: 'video/mp4' as const,
			});
		},
		async encodeToSink() { throw new Error('picture test does not use a sink'); },
	});
	const runtime = {
		...fixture.runtime,
		getProject: () => project,
		findClip: (_value: unknown, id: string) => (
			project.clips.find((clip) => clip.id === id)
		),
		findSource: (_value: unknown, id: string) => (
			project.sources.find((source) => source.id === id)
		),
		options: { productVideoExportStrategy: strategy },
	};
	return {
		capture,
		exportVideo: createEditorVideoExportAction(runtime as never, async () => Object.freeze({
			sampleRate: SAMPLE_RATE,
			channels: [new Float32Array(SAMPLE_RATE), new Float32Array(SAMPLE_RATE)],
		})),
	};
}
