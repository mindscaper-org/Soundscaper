/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	commitPasteIntoExistingClipCommand,
	type CommittedPasteIntoExistingClipRequest,
} from '../src/common/editor/controller/edit/paste-existing-clip-service.ts';
import type { ControllerClip, ControllerProject, ControllerSource } from '../src/common/editor/controller/track-audio/track-domain-types.ts';

function fixture(clips: readonly ControllerClip[]) {
	const source: ControllerSource = {
		id: 'source', storageKey: 'source', name: 'Source', mimeType: 'audio/wav',
		frameCount: 2, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
	};
	const project: ControllerProject = {
		schemaVersion: 17, id: 'project', title: 'Project', sampleRate: 48_000,
		clips, sources: [source], tracks: [{ id: 'track', name: 'Track', type: 'audio', clipIds: clips.map(({ id }) => id) }],
		mixer: { groups: [], sends: [], routes: {} },
	};
	let committed: unknown;
	let writes = 0;
	const request: CommittedPasteIntoExistingClipRequest = {
		project,
		command: {
			type: 'clipboard/paste', atFrame: 1, mode: 'overlap', pasteIntoExistingClip: true,
			trackMap: { copied: 'track' }, clipIds: { copied: 'pasted' },
			clipboard: {
				schemaVersion: 2, sampleRate: 48_000, durationFrames: 1,
				tracks: [{
					sourceTrackId: 'copied', sourceTrackName: 'Copied', sourceTrackType: 'audio',
					clips: [{ key: 'copied', sourceId: 'source', offsetFrame: 0,
						sourceStartFrame: 0, sourceDurationFrames: 1, durationFrames: 1 }],
				}],
			},
		},
		derivedSources: {
			sourceChannelsForEdit: () => Promise.resolve([Float32Array.of(0.25, 0.5)]),
			persistDerivedSource: (template, channels) => {
				writes++;
				return Promise.resolve({ source: { ...template, id: 'joined', frameCount: channels[0]!.length }, channels, buffer: null });
			},
			rollbackDerivedSources: () => Promise.resolve(),
		},
		preflightStorage: () => Promise.resolve(), assertCurrent: () => undefined,
		commit: (command) => { committed = command; return 'committed'; },
	};
	return { project, request, committed: () => committed, writes: () => writes };
}

function clip(id: string, start = 0): ControllerClip {
	return { id, sourceId: 'source', timelineStartFrame: start, durationFrames: 2, sourceStartFrame: 0, sourceDurationFrames: 2 };
}

test('paste into a dense existing track indexes clip IDs once through planning and collision rewriting', async () => {
	const count = 2_000;
	let idReads = 0;
	const clips = Array.from({ length: count }, (_, index): ControllerClip => ({
		...clip(`clip-${String(index)}`, index * 4),
		get id() { idReads++; return `clip-${String(index)}`; },
	}));
	const value = fixture(clips);
	idReads = 0;
	assert.equal(await commitPasteIntoExistingClipCommand(value.request), 'committed');
	assert.equal(value.writes(), 1);
	assert.ok(idReads <= count * 5, `expected linear ID reads, received ${String(idReads)}`);
});

