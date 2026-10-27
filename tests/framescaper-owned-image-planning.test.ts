/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperBaselineImageFixture, imagePasteCommand } from './helpers/framescaper-baseline-image-fixture.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createClipboardDescriptor, preparePasteCommand } from '../src/common/editor/commands/clipboard-runtime.js';
import { openFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { mapFramescaperImageTimelineFrameV1 } from '../src/common/editor/timeline-image-model.ts';
import { mapFramescaperImageFrameAtSampleTimelineImage } from '../src/framescaper/editor-selected-timeline-image-image-frame-source.ts';
import { sequenceFrameBoundarySample } from '../src/common/editor/sequence-frame-navigation.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';
import { reconcileFramescaperProjectFeatureRequirements } from '../src/framescaper/editor-project-feature-requirements.ts';

test('Copy binds colon-bearing clip IDs by exact identity before the two geometry suffixes', () => {
	const runtime = createEditorProjectRuntimeSelection(PROFILE);
	const first = createFramescaperBaselineImageFixture({ clipId: 'a', imageOnly: true });
	const other = createFramescaperBaselineImageFixture({ clipId: 'a:0', sourceId: 'other-image', originalText: 'different image', imageOnly: true });
	const project = runtime.applyCommand(first.project, { type: 'batch', commands: [
		{ type: 'image-source/set', sourceId: other.source.id, expectedSource: null, source: other.source },
		{ type: 'image-clip/set', clipId: other.clip.id, expectedClip: null, expectedPlacement: null, clip: { ...other.clip, sequenceStartFrame: 200 }, placement: { scope: 'timeline', trackId: 'video-track' } },
	] });
	const descriptor = createClipboardDescriptor(runtime.projectForEditClipboardConsumers(project), { startFrame: 0, endFrame: 240_000, trackIds: ['video-track'], clipIds: ['a'] });
	const carrier = runtime.createEditSessionClipboard(project, descriptor);
	assert.deepEqual(carrier.images.clips.map(clip => clip.id), ['a']);
	const command = runtime.prepareEditClipboardPasteCommand(project, carrier, imagePasteCommand(descriptor), prefix => `${prefix}-copy`);
	const pasted = runtime.applyCommand(project, command);
	assert.equal(pasted.clips.filter(clip => clip.kind === 'image' && clip.sourceId === first.source.id).length, 2);
});

test('same-project image Paste indexes owned source, binding and descriptor lookups once', context => {
	const runtime = createEditorProjectRuntimeSelection(PROFILE);
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const options = framescaperBaselineOptions();
	const sources = Array.from({ length: 40 }, (_, index) => ({ ...fixture.source, id: `owned-image-${index}`, storageKey: `owned-image-${index}` }));
	const clips = Array.from({ length: 40 }, (_, index) => ({ ...fixture.clip, id: `owned-clip-${index}`, sourceId: `owned-image-${index}`, sequenceStartFrame: index * 10, sequenceFrameCount: 10 }));
	options.projectBin = { clips: [] };
	options.sources = []; options.clips = [];
	options.tracks = [{ id: 'video-track', type: 'video', name: 'Images', clipIds: [] }];
	options.sequences = [{ id: 'main-sequence', rate: { num: 30, den: 1 }, trackIds: ['video-track'] }];
	const project = createFramescaperProject(PROFILE, options);
	Object.assign(project, { sources, clips }); Object.assign(project.tracks[0]!, { clipIds: clips.map(clip => clip.id) });
	Object.assign(project, { featureRequirements: reconcileFramescaperProjectFeatureRequirements(PROFILE, project) });
	const descriptor = createClipboardDescriptor(runtime.projectForEditClipboardConsumers(project), { startFrame: 0, endFrame: 640_000, trackIds: ['video-track'] });
	const clipboard = runtime.createEditSessionClipboard(project, descriptor);
	const original = Array.prototype.find;
	let visits = 0;
	context.after(() => { Object.defineProperty(Array.prototype, 'find', { value: original, configurable: true, writable: true }); });
	Object.defineProperty(Array.prototype, 'find', { configurable: true, writable: true, value: function (this: unknown[], callback: (value: unknown, index: number, values: unknown[]) => unknown, receiver?: unknown) {
		const first = this[0] as { kind?: unknown; descriptorKey?: unknown; key?: unknown } | undefined;
		const owned = this.length === 40 && (first?.kind === 'image' || typeof first?.descriptorKey === 'string' || typeof first?.key === 'string')
			&& new Error().stack?.includes('editor-session-clipboard-v13-paste');
		return original.call(this, (value: unknown, index: number, values: unknown[]) => { if (owned) visits += 1; return callback.call(receiver, value, index, values); });
	} });
	let next = 0;
	const createId = (prefix = 'id') => `${prefix}-${String(++next)}`;
	const paste = preparePasteCommand(descriptor, { atFrame: 640_000, mode: 'overlap', trackMap: { 'video-track': 'video-track' } }, createId);
	const command = runtime.prepareEditClipboardPasteCommand(project, clipboard, paste, createId);
	assert.ok(command);
	assert.ok(visits <= 120, `owned paste lookups should be linear, received ${visits} predicates`);
});

test('authenticated image addressing reuses reader timing preparation and preserves rational phase', async context => {
	const fixture = createFramescaperBaselineImageFixture();
	const reader = await openFramescaperImageFramePackV1({ source: fixture.source, read: (offset, length) => Promise.resolve(fixture.bytes.slice(offset, offset + length)) });
	const original = Array.prototype.map;
	let timingVisits = 0;
	const restore = () => { Object.defineProperty(Array.prototype, 'map', { value: original, configurable: true, writable: true }); };
	context.after(restore);
	Object.defineProperty(Array.prototype, 'map', { configurable: true, writable: true, value: function (this: unknown[], callback: (value: unknown, index: number, values: unknown[]) => unknown, receiver?: unknown) {
		const first = this[0] as { presentationTicks?: unknown; durationTicks?: unknown } | undefined;
		if (typeof first?.presentationTicks === 'bigint' && typeof first.durationTicks === 'bigint') timingVisits += this.length;
		return original.call(this, callback, receiver);
	} });
	const rate = { num: 30_000, den: 1_001 };
	const clip = { ...fixture.clip, sourceStartFraction: { num: '1', den: '3' } };
	const addresses = Array.from({ length: 150 }, (_, frame) => mapFramescaperImageFrameAtSampleTimelineImage(reader, clip, sequenceFrameBoundarySample(frame, rate, 48_000), rate, 48_000));
	assert.equal(timingVisits, 0, 'ready addressing must not normalize any reader timing records');
	restore();
	assert.deepEqual(addresses, Array.from({ length: 150 }, (_, frame) => mapFramescaperImageTimelineFrameV1({ clip, sequenceFrame: frame, sequenceRate: rate, timings: reader.timings })));
});
