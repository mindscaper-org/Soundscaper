/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import * as timeline from '../src/common/editor/video-timeline.js';

test('video preview and full composition share admitted ordering and bounded active-clip queries', () => {
	const count = 1_000, options = framescaperV20Options();
	const clips = options.clips as Record<string, unknown>[], tracks = options.tracks as Record<string, unknown>[];
	const template = clips.find(clip => clip.kind === 'video'), track = tracks.find(item => item.type === 'video');
	assert.ok(template && track);
	options.clips = [...Array.from({ length: count }, (_, index) => ({ ...template, id: `v${index}`, avLinkId: null,
		sequenceStartFrame: index * 10 })), ...clips.filter(clip => clip.kind !== 'video').map(clip => ({ ...clip, avLinkId: null }))];
	track.clipIds = Array.from({ length: count }, (_, index) => `v${index}`);
	const project = createFramescaperProjectNativeMedia(PROFILE, options), runtime = projectForRuntimeConsumers(project);
	const sort = Array.prototype.sort, filter = Array.prototype.filter;
	let comparisons = 0, visits = 0;
	Object.defineProperty(Array.prototype, 'sort', { configurable: true, writable: true,
		value(this: unknown[], compare: (left: unknown, right: unknown) => number) {
			return sort.call(this, this.length === count ? (left, right) => { comparisons++; return compare(left, right); } : compare);
		} });
	Object.defineProperty(Array.prototype, 'filter', { configurable: true, writable: true,
		value(this: unknown[], predicate: (value: unknown, index: number, values: unknown[]) => unknown, receiver?: unknown) {
			return filter.call(this, this.length === count ? (value, index, values) => { visits++; return predicate.call(receiver, value, index, values); } : predicate, receiver);
		} });
	try {
		const prepared = timeline.createVideoTimelineResolver?.(runtime);
		let presentations = 0;
		for (let index = 0; index < 30; index++) {
			const layers = prepared ? prepared.resolveActiveVideoLayers(index * 4_800, {
				resolveClipPresentation() { presentations++; return null; },
			})
				: timeline.resolveActiveVideoLayers(runtime, index * 4_800);
			assert.equal(layers.length, 1); assert.equal(layers[0]!.clips.length, 1);
		}
		if (prepared) {
			assert.equal(presentations, 30, 'presentation callbacks must be evaluated for every frame');
			let visible = false;
			const visibility = { isTrackVisible: () => visible };
			assert.equal(prepared.resolveActiveVideoLayers(0, visibility).length, 0);
			visible = true;
			assert.equal(prepared.resolveActiveVideoLayers(0, visibility).length, 1);
		}
		const intervals = timeline.resolveVideoCompositionIntervals(runtime, { startFrame: 0, endFrame: count * 48_000 });
		assert.equal(intervals.length, count);
		assert.deepEqual(intervals.map(interval => interval.layers[0]!.clips[0]!.clipId), Array.from({ length: count }, (_, index) => `v${index}`));
	} finally {
		Object.defineProperty(Array.prototype, 'sort', { configurable: true, writable: true, value: sort });
		Object.defineProperty(Array.prototype, 'filter', { configurable: true, writable: true, value: filter });
	}
	assert.ok(comparisons <= count * 8, `${comparisons} repeated ordering comparisons`);
	assert.ok(visits <= count * 8, `${visits} full clip-filter visits`);
});
