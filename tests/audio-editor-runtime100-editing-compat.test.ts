/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePunchCommand } from '../src/common/editor/commands/range-runtime.js';
import { assertPasteSequenceMaps, preparePasteAnnotationMaps } from '../src/common/editor/commands/clipboard-annotation-command.ts';
import { prepareMediaNewTrackPlan } from '../src/common/editor/controller/clip-video/internal/clip/media-new-track-plan.ts';
import type { AudioEditorClipboard } from '../src/common/editor/commands/protocol.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import { mixerAssignmentIndex } from '../src/common/editor/mixer-assignment-index.ts';
import { createDefaultMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { commandFixture } from './helpers/round3-command-fixtures.ts';

test('immutable punch reads preserve ordinary output and stable lookup tracing', () => {
	for (const variant of ['ordinary', 'get-id', 'get-array', 'custom-find'] as const) {
		function run(frozen: boolean) {
			const project = commandFixture(16);
			let idReads = 0, arrayReads = 0, next = 0;
			for (const clip of project.clips) { clip.timelineStartFrame = 0; clip.durationFrames = 20; }
			if (variant === 'get-id') {
				const clip = project.clips[0]!, id = clip.id;
				Object.defineProperty(clip, 'id', { enumerable: true, get() { idReads++; return id; } });
			}
			if (variant === 'custom-find') Object.defineProperty(project.clips, 'find', { value: (predicate: (clip: object) => unknown) => Array.prototype.find.call(project.clips, predicate) as unknown });
			const original = project.clips;
			if (frozen) { for (const clip of original) if (clip) Object.freeze(clip); Object.freeze(original); }
			if (variant === 'get-array') Object.defineProperty(project, 'clips', { get() { arrayReads++; return original; }, configurable: true });
			const makeId = (prefix = 'clip') => {
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

test('assignment index does not invoke enabled getters', () => {
	const graph = createDefaultMixerGraphV21([{ id: 'track' }]);
	let reads = 0;
	const edge = { ...graph.edges[0]!, get enabled() { reads++; return true; } };
	assert.equal(mixerAssignmentIndex([edge]), null);
	assert.equal(reads, 0);
});

test('E13 media new-track planning preserves authored track inventory accessor reads', () => {
	const project = commandFixture(2, 2) as unknown as ClipTransformProject;
	const tracks = project.tracks;
	let reads = 0;
	Object.defineProperty(project, 'tracks', { get() { reads++; return tracks; } });
	assert.equal(prepareMediaNewTrackPlan(project, [project.clips[0]!], () => 'new-track', 'Audio').commands.length, 1);
	// The audio name also reads project.tracks.length inside its authored creation branch.
	assert.equal(reads, 3);
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
