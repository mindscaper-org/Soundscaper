/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject, validateFramescaperProject } from '../src/framescaper/editor-project.ts';
import { reconcileFramescaperProjectFeatureRequirements } from '../src/framescaper/editor-project-feature-requirements.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { normalizeFramescaperSessionClipboardV13 } from '../src/framescaper/editor-session-clipboard-v13.ts';
import { normalizeFramescaperImageSourceV1, normalizeFramescaperImageClipV1 } from '../src/common/editor/timeline-image-model.ts';
import { createClipboardDescriptor } from '../src/common/editor/commands/clipboard-runtime.js';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { profile } from './helpers/framescaper-catalog-work-fixtures.ts';

test('actual selected image Copy shares source inventories after exact descriptor binding', () => {
	const count = 200, template = createFramescaperBaselineImageFixture({ imageOnly: true });
	const options = framescaperV20Options();
	options.sources = []; options.clips = []; options.projectBin = { clips: [] };
	const track = (options.tracks as Record<string, unknown>[])[0]!;
	options.tracks = [{ ...track, clipIds: [] }];
	(options.sequences as Record<string, unknown>[])[0]!.trackIds = [track.id];
	const project = structuredClone(createFramescaperProject(profile, options)) as unknown as Record<string, unknown>;
	const sources = Array.from({ length: count }, (_, index) => normalizeFramescaperImageSourceV1({ ...template.source, id: `image-source-${index}`, storageKey: `image-source-${index}` }));
	const clips = Array.from({ length: count }, (_, index) => normalizeFramescaperImageClipV1({ ...template.clip, id: `image-clip:${index}:0`,
		sourceId: sources[index]!.id, sequenceId: 'main-sequence', sequenceStartFrame: index * 10, sequenceFrameCount: 10 }));
	project.sources = sources; project.clips = clips;
	(project.tracks as Record<string, unknown>[])[0]!.clipIds = clips.map(clip => clip.id);
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirements(profile, project); validateFramescaperProject(profile, project);
	const runtime = createEditorProjectRuntimeSelection(profile);
	const descriptor = createClipboardDescriptor(runtime.projectForEditClipboardConsumers(project), { startFrame: 0, endFrame: count * 48_000, trackIds: [String(track.id)] });
	assert.equal(descriptor.tracks[0]!.clips.length, count);
	const find = Array.prototype.find;
	let visits = 0;
	Array.prototype.find = function<T>(this: T[], callback: (value: T, index: number, array: T[]) => unknown, receiver?: unknown): T | undefined {
		if (this.length !== count || (this[0] as { id?: unknown })?.id !== 'image-source-0' || !new Error().stack?.includes('imageClipsForBindings')) return find.call(this, callback, receiver);
		return find.call(this, (value: T, index: number, array: T[]) => { visits++; return callback.call(receiver, value, index, array); });
	};
	let copied: unknown;
	try { copied = runtime.createEditSessionClipboard!(project, descriptor); }
	finally { Array.prototype.find = find; }
	const clipboard = normalizeFramescaperSessionClipboardV13(copied);
	assert.deepEqual(clipboard.images.clips, clips);
	assert.deepEqual(new Map(clipboard.sources.map(source => [source.id, source])), new Map(sources.map(source => [source.id, source])));
	assert.deepEqual(clipboard.clipBindings.map(binding => binding.clipId), clips.map(clip => clip.id));
	assert.ok(visits <= count * 4, `${visits} image-source lookup predicates`);
});
