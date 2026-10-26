import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createTrackStructuralOperationService } from '../src/common/editor/controller/track-audio/internal/track-structural-operation-service.ts';
import type { ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

const NOW = '2026-10-26T00:00:00.000Z';

test('actual Mute All shares an owned command draft across every necessary track update', () => {
	const count = 100;
	const project = createSoundscaperProject({ id: 'mute-batch-work', now: NOW,
		tracks: Array.from({ length: count }, (_, index) => ({ id: `track-${index}`, clipIds: [] })) });
	const commands: AudioEditorCommand[] = [];
	createTrackStructuralOperationService({ lifetime: { assertActive() {} }, getProject: () => project as unknown as ControllerProject,
		getSelectedTrackId: () => null, editingBlocked: () => false, getPositionFrames: () => 0,
		commit: command => { commands.push(command); } }).muteAll();
	const command = commands[0];
	assert.ok(command?.type === 'batch');
	assert.equal(command.commands.length, count);
	const original = globalThis.structuredClone;
	let clones = 0, trackRecords = 0;
	globalThis.structuredClone = function<T>(value: T, options?: StructuredSerializeOptions): T {
		if (value && typeof value === 'object' && 'tracks' in value && 'clips' in value && new Error().stack?.includes('plainClone')) {
			clones++; trackRecords += (value as { tracks: unknown[] }).tracks.length;
		}
		return original(value, options);
	};
	let applied: ReturnType<typeof applySoundscaperProjectCommand>;
	try {
		applied = applySoundscaperProjectCommand(project, command, { now: NOW });
		assert.ok(clones <= 2, `${clones} complete inherited command draft clones`);
		assert.ok(trackRecords <= count * 2, `${trackRecords} cloned track records`);
	} finally { globalThis.structuredClone = original; }
	assert.ok(applied.tracks.every(track => track.mute === true));
	assert.ok(project.tracks.every(track => track.mute === false));
	assert.equal(applied.revision, project.revision + 1);
	assert.deepEqual(applied.mixer, project.mixer);
	assert.deepEqual(applied.clips, project.clips);
});

test('a track display command leaves clip authority intact without building timing strings', () => {
	const count = 500;
	const project = createSoundscaperProject({ id: 'display-timing-work', now: NOW,
		sources: [{ id: 'source', storageKey: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 64 }],
		tracks: [{ id: 'audio', clipIds: Array.from({ length: count }, (_, index) => `clip-${index}`) }],
		clips: Array.from({ length: count }, (_, index) => ({ id: `clip-${index}`, sourceId: 'source', timelineStartFrame: index * 64,
			sourceStartFrame: 0, sourceDurationFrames: 64, durationFrames: 64 })) });
	const original = Array.prototype.map;
	let signatures = 0;
	Array.prototype.map = function<T, R>(this: T[], transform: (value: T, index: number, array: T[]) => R, receiver?: unknown): R[] {
		if (this.length === 4 && new Error().stack?.includes('commandTimingSignature')) signatures++;
		return original.call(this, transform, receiver) as R[];
	};
	try {
		const applied = applySoundscaperProjectCommand(project, { type: 'track/update', trackId: 'audio', changes: { displayMode: 'spectrogram' } }, { now: NOW });
		assert.equal(applied.tracks[0]!.displayMode, 'spectrogram');
		assert.deepEqual(applied.clips, project.clips);
		assert.equal(signatures, 0);
	} finally { Array.prototype.map = original; }
});
