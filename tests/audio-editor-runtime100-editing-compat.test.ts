/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePunchCommand } from '../src/common/editor/commands/range-runtime.js';
import { assertPasteSequenceMaps, preparePasteAnnotationMaps } from '../src/common/editor/commands/clipboard-annotation-command.ts';
import { clipMoveSelection } from '../src/common/editor/controller/clip-video/internal/clip/clip-move-options.ts';
import type { AudioEditorClipboard } from '../src/common/editor/commands/protocol.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import { mixerAssignmentIndex } from '../src/common/editor/mixer-assignment-index.ts';
import { createDefaultMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { commandFixture } from './helpers/round3-command-fixtures.ts';

test('immutable punch reads preserve duplicate IDs, sparse errors, getters and custom finds', () => {
	for (const variant of ['ordinary', 'duplicate', 'sparse', 'get-id', 'get-array', 'custom-find', 'factory-replacement', 'factory-getter'] as const) {
		function run(frozen: boolean) {
			const project = commandFixture(16);
			let idReads = 0, arrayReads = 0, next = 0;
			for (const clip of project.clips) { clip.timelineStartFrame = 0; clip.durationFrames = 20; }
			if (variant === 'duplicate') project.clips[1]!.id = project.clips[0]!.id;
			if (variant === 'sparse') delete project.clips[0];
			if (variant === 'get-id') {
				const clip = project.clips[0]!, id = clip.id;
				Object.defineProperty(clip, 'id', { enumerable: true, get() { idReads++; return id; } });
			}
			if (variant === 'custom-find') Object.defineProperty(project.clips, 'find', { value: (predicate: (clip: object) => unknown) => Array.prototype.find.call(project.clips, predicate) as unknown });
			const original = project.clips;
			if (frozen) { for (const clip of original) if (clip) Object.freeze(clip); Object.freeze(original); }
			if (variant === 'get-array') Object.defineProperty(project, 'clips', { get() { arrayReads++; return original; }, configurable: true });
			const makeId = (prefix: string) => {
				if (next === 0 && (variant === 'factory-replacement' || variant === 'factory-getter')) {
					const replacement = original.map(clip => ({ ...clip, timelineStartFrame: 100 }));
					if (variant === 'factory-getter') Object.defineProperty(project, 'clips', { get() { arrayReads++; return replacement; }, configurable: true });
					else project.clips = replacement;
				}
				return `${prefix}-${next++}`;
			};
			let result: unknown, error: unknown;
			try { result = preparePunchCommand(project, { trackId: 'track-0', startFrame: 5, endFrame: 10, clipId: 'replacement' }, makeId); }
			catch (failure) { assert.ok(failure instanceof Error); error = { name: failure.name, message: failure.message }; }
			return { result, error, idReads, arrayReads };
		}
		assert.deepEqual(run(true), run(false), variant);
	}
});

test('assignment index never invokes getters and falls back for custom array authority', () => {
	const graph = createDefaultMixerGraphV21([{ id: 'track' }]);
	let reads = 0;
	const edge = { ...graph.edges[0]!, get enabled() { reads++; return true; } };
	assert.equal(mixerAssignmentIndex([edge]), null);
	assert.equal(reads, 0);
	const edges = [...graph.edges];
	Object.defineProperty(edges, 'some', { value: () => true });
	assert.equal(mixerAssignmentIndex(edges), null);
	const sparse = [...graph.edges]; delete sparse[0];
	assert.equal(mixerAssignmentIndex(sparse), null);
});

test('selection membership keeps live getter order and custom includes authority', () => {
	const project = commandFixture(2, 2) as unknown as ClipTransformProject;
	const selected = ['clip-0'];
	Object.defineProperty(project.tracks[0]!, 'clipIds', { get() { selected[0] = 'clip-1'; return ['clip-0']; } });
	assert.deepEqual(clipMoveSelection(project, selected, { allOnTrack: true })?.trackIds, ['track-1']);
	const custom = ['absent'];
	Object.defineProperty(custom, 'includes', { value: () => true });
	assert.deepEqual(clipMoveSelection(commandFixture(2, 2) as unknown as ClipTransformProject, custom, { allOnTrack: true })?.trackIds, ['track-0', 'track-1']);
});

test('annotation destination maps preserve first sequence authority and missing new-track diagnostics', () => {
	const track = Object.freeze({ id: 'track' });
	const first = Object.freeze({ id: 'first', trackIds: Object.freeze(['track']) });
	const second = Object.freeze({ id: 'second', trackIds: Object.freeze(['track']) });
	const project = { tracks: Object.freeze([track]), sequences: Object.freeze([first, second]), primarySequenceId: 'second', sampleRate: 48000 };
	const clipboard = { schemaVersion: 3, tracks: [{ sourceTrackId: 'track', sourceSequenceId: 'source' }], annotations: [] } as unknown as AudioEditorClipboard;
	const command: Record<string, unknown> = {};
	preparePasteAnnotationMaps(clipboard, { project }, command, () => 'new');
	assert.deepEqual(command.sequenceMap, { source: 'first' });
	assertPasteSequenceMaps(project, clipboard, command);
	assert.throws(() => preparePasteAnnotationMaps({ ...clipboard, tracks: [{ sourceTrackId: 'absent', sourceSequenceId: 'source', clips: [] }] } as unknown as AudioEditorClipboard, { project: { ...project, primarySequenceId: '' } }, {}, () => 'new'), /target sequence for new track absent/u);
});
