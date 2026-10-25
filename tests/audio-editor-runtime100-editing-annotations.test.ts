/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPasteSequenceMaps, preparePasteAnnotationMaps } from '../src/common/editor/commands/clipboard-annotation-command.ts';
import type { AudioEditorClipboard } from '../src/common/editor/commands/protocol.ts';
import { visits } from './helpers/runtime50-editing-metrics.ts';

function fixture() {
	const tracks = Object.freeze(Array.from({ length: 200 }, (_, index) => Object.freeze({ id: `track-${index}`, type: 'audio' })));
	const sequences = Object.freeze(tracks.map((track, index) => Object.freeze({ id: `sequence-${index}`, trackIds: Object.freeze([track.id]) })));
	const project = { tracks, sequences, sampleRate: 48000, primarySequenceId: 'sequence-0' };
	const clipboard = { schemaVersion: 3, tracks: tracks.map((track, index) => ({ sourceTrackId: track.id, sourceSequenceId: sequences[index]!.id, clips: [] })), annotations: [] } as unknown as AudioEditorClipboard;
	return { project, clipboard };
}

test('E16 annotation paste preparation indexes immutable destination sequence ownership', context => {
	const { project, clipboard } = fixture();
	const command: Record<string, unknown> = {};
	const count = visits('find', () => preparePasteAnnotationMaps(clipboard, { project }, command, prefix => `${prefix}-new`));
	assert.deepEqual(command.sequenceMap, Object.fromEntries(project.sequences.map(sequence => [sequence.id, sequence.id])));
	context.diagnostic(`E16 sequence find visits: ${count}`);
	assert.ok(count < 1000);
});

test('E17 annotation paste admission resolves copied track ownership once', context => {
	const { project, clipboard } = fixture();
	const sequenceMap = Object.fromEntries(project.sequences.map(sequence => [sequence.id, sequence.id]));
	const count = visits('find', () => assertPasteSequenceMaps(project, clipboard, { sequenceMap }));
	context.diagnostic(`E17 sequence find visits: ${count}`);
	assert.ok(count < 1000);
	assert.throws(() => assertPasteSequenceMaps(project, clipboard, { sequenceMap: { ...sequenceMap, 'sequence-199': 'sequence-0' } }), /does not map/u);
});

test('E16 annotation-only paste preserves a custom sequence map result for immutable inventories', () => {
	const clipboard = { schemaVersion: 3, tracks: [], annotations: [{ sourceSequenceId: 'source', key: 'annotation' }] } as unknown as AudioEditorClipboard;
	for (const frozen of [false, true]) {
		let mapCalls = 0;
		const sequences = [Object.freeze({ id: 'source', trackIds: Object.freeze([]) })];
		Object.defineProperty(sequences, 'map', { value: () => { mapCalls++; return []; } });
		if (frozen) Object.freeze(sequences);
		const project = { tracks: Object.freeze([]), sequences, primarySequenceId: 'source', sampleRate: 48000 };
		const command: Record<string, unknown> = {};
		let allocated = 0;
		assert.throws(() => preparePasteAnnotationMaps(clipboard, { project }, command, () => `annotation-${String(++allocated)}`), {
			name: 'TypeError', message: 'A target sequence map is required for source.',
		});
		assert.deepEqual(command, {});
		assert.equal(mapCalls, 1);
		assert.equal(allocated, 0);
	}
});
