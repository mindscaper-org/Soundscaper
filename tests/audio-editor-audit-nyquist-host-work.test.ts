/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNyquistHostService, type NyquistHostProject } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-host-service.ts';
import type { EffectTarget } from '../src/common/editor/controller/effects/effect-selection-service.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

test('one multi-track Nyquist operation shares selected track ordinals and projected catalogs', () => {
	const count = 100;
	const admitted = createSoundscaperProject({ id: 'nyquist-host-work',
		sources: [{ id: 'source', storageKey: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 64 }],
		clips: Array.from({ length: count }, (_, index) => ({ id: `c${index}`, sourceId: 'source', sourceStartFrame: 0,
			sourceDurationFrames: 64, durationFrames: 64, timelineStartFrame: 0 })),
		tracks: Array.from({ length: count }, (_, index) => ({ id: `t${index}`, clipIds: [`c${index}`] })),
	});
	const project = admitted as unknown as NyquistHostProject;
	const targets: EffectTarget[] = project.tracks.map((track, index) => ({ track, clipIds: [`c${index}`],
		startFrame: 0, endFrame: 64, durationFrames: 64, channelCount: 1, hasAudio: true }));
	const unexpected = (): never => assert.fail('Preparing host properties must not start audio or author media.');
	const service = createNyquistHostService({
		state: { selectedTrackId: 't0', nyquistAbort: null, audacityEffectProcessing: false, audacityPreviewSource: null },
		copy: { labels: 'Labels', playing: 'Playing', ready: 'Ready' }, locale: 'en', getProject: () => project,
		captureProject: unexpected, assertProject: unexpected, activeSelection: () => null, projectSampleRate: () => 48_000,
		getPositionFrames: () => 0, getAudioContext: unexpected, getPlaybackDestination: unexpected, pauseTransport: unexpected,
		assertAudioOutput: unexpected, bufferFromChannels: unexpected, cancelAudacityEffectPreview: unexpected,
		createId: unexpected, commit: unexpected, setStatus: unexpected, publishDocumentSnapshot: unexpected,
	});
	const original = Array.prototype.findIndex;
	let visits = 0;
	Object.defineProperty(Array.prototype, 'findIndex', { configurable: true, writable: true,
		value(this: unknown[], predicate: (value: unknown, index: number, values: unknown[]) => unknown, receiver?: unknown) {
			return original.call(this, (value, index, values) => { visits++; return predicate.call(receiver, value, index, values); });
		} });
	try {
		const prepared = service.prepareNyquistHostProperties?.(targets) ?? service.nyquistHostProperties;
		for (const [index, target] of targets.entries()) {
			const properties = prepared(target, targets, index, [Float32Array.of(0.25)], {});
			assert.equal(properties.TRACK.INDEX, index + 1);
			assert.equal(properties.PROJECT.WAVETRACKS, count);
			assert.deepEqual(properties.SELECTION.TRACKS, Array.from({ length: count }, (_, item) => item + 1));
			assert.equal(properties.SELECTION.PEAK, 0.25);
		}
		assert.ok(visits <= count * 4, `${visits} ordinal predicates`);
	} finally { Object.defineProperty(Array.prototype, 'findIndex', { configurable: true, writable: true, value: original }); }
});
