import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createSelectedLabelClipboardService } from '../src/common/editor/controller/edit/internal/selected-label-clipboard.ts';
import { normalizeLabelClipboardDescriptor } from '../src/common/editor/commands/label-clipboard-codec.ts';
import { normalizeAudioEditorSessionClipboard } from '../src/common/editor/session-clipboard-codec.ts';
import { sampleFrameToBeat } from '../src/common/editor/timeline-tempo-inverse.ts';
import type { AudioEditorClipboard, AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import type { SelectedLabelState } from '../src/common/editor/label-clipboard-selection.ts';

const LABEL_COUNT = 100;
const PROJECT = createSoundscaperProject({ id: 'musical-label-work', sampleRate: 48_000,
	tempoMap: { mode: 'musical', events: Array.from({ length: 64 }, (_, index) => ({ id: `tempo-${index}`,
		beat: { num: index, den: 64 }, bpm: { num: index % 2 ? 125 : 120, den: 1 } })) },
	tracks: [{ id: 'labels', type: 'label', labels: Array.from({ length: LABEL_COUNT }, (_, index) => ({
		id: `label-${index}`, title: `Cue ${index}`, anchor: 'musical', startBeat: { num: index + 1, den: 1 }, endBeat: { num: index + 2, den: 1 },
		opaqueExtensions: { 'example.test': { retained: index } },
	})) }] });

test('an unrelated command prepares one exact base-tempo projector for all musical labels', () => {
	let preparations = 0;
	const original = Array.prototype.entries;
	Array.prototype.entries = function<T>(this: T[]): ArrayIterator<[number, T]> {
		if (new Error().stack?.includes('project-command-projection.ts')) preparations++;
		return Reflect.apply(original, this, []) as ArrayIterator<[number, T]>;
	};
	try {
		const renamed = applySoundscaperProjectCommand(PROJECT, { type: 'project/rename', title: 'Renamed' }, { now: '2026-10-26T00:00:00.000Z' });
		assert.equal(renamed.title, 'Renamed');
		assert.deepEqual(renamed.tracks, PROJECT.tracks);
		assert.ok(preparations <= 8, `${preparations} tempo preparations while reconciling ${LABEL_COUNT} labels`);
	} finally { Array.prototype.entries = original; }
});

test('real musical label Copy and Paste share one inverse projector and preserve the entire command', () => {
	const runtime = resolveRuntimeProjectProjection(PROJECT);
	const state: SelectedLabelState & { clipboard: AudioEditorClipboard | null; selectedTrackId: string | null; selectedClipId: string | null } = {
		clipboard: null, selectedTrackId: 'labels', selectedClipId: null,
	};
	const commands: AudioEditorCommand[] = [];
	let nextId = 0;
	const atFrame = 480_000;
	const service = createSelectedLabelClipboardService({ state, getProject: () => runtime, getPositionFrames: () => atFrame,
		createId: prefix => `${prefix}-copy-${++nextId}`, updateSelection() {}, commit: command => { commands.push(command); },
		prepareClipboard: descriptor => {
			const wire = normalizeAudioEditorSessionClipboard({ schemaVersion: 1, originProjectId: PROJECT.id, descriptor, sources: [] });
			return () => { state.clipboard = wire.descriptor; };
		}, publish() {}, copy: { labelTrackMissing: 'Missing label track' }, setStatus() {},
	});
	for (let index = 0; index < LABEL_COUNT; index++) service.select('labels', `label-${index}`, { additive: index > 0 });
	assert.equal(service.handle('copy'), true);
	assert.ok(state.clipboard?.schemaVersion === 7);
	const descriptor = normalizeLabelClipboardDescriptor(state.clipboard);
	let preparations = 0;
	const original = Array.prototype.entries;
	Array.prototype.entries = function<T>(this: T[]): ArrayIterator<[number, T]> {
		if (this === PROJECT.tempoMap.events) preparations++;
		return Reflect.apply(original, this, []) as ArrayIterator<[number, T]>;
	};
	try {
		assert.equal(service.handle('paste'), true);
		assert.ok(preparations <= 2, `${preparations} inverse tempo preparations for ${LABEL_COUNT} pasted labels`);
	} finally { Array.prototype.entries = original; }
	const expected = { type: 'batch', commands: descriptor.labels.map((label, index) => ({ type: 'label/add', trackId: 'labels', label: {
		id: `label-copy-${index + 1}`, title: label.title, color: label.color, opaqueExtensions: structuredClone(label.opaqueExtensions), anchor: 'musical',
		startBeat: sampleFrameToBeat(atFrame + label.startOffsetFrame, PROJECT.tempoMap, PROJECT.sampleRate),
		endBeat: sampleFrameToBeat(atFrame + label.endOffsetFrame, PROJECT.tempoMap, PROJECT.sampleRate),
	} })) };
	assert.deepEqual(commands, [expected]);
	const applied = applySoundscaperProjectCommand(PROJECT, commands[0]!);
	const track = applied.tracks[0];
	assert.ok(track?.type === 'label');
	assert.equal(track.labels.length, LABEL_COUNT * 2);
});
