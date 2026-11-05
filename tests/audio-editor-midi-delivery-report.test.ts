/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { DeliveryReport } from '../src/common/editor/delivery-report.ts';
import { createDeliveryReport, sealDeliveryReport } from '../src/common/editor/delivery-report.ts';
import { createMidiService } from '../src/common/editor/controller/track-audio/midi-service.ts';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';
import { createAudioEditorProjectV17, validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { midiFileDeliveryReport } from '../src/common/editor/midi-file-delivery-report.ts';

async function fixture() {
	const base = midiServiceFixture();
	const bytes = writeMidiFile({ sampleRate: 8000, tempos: [{ frame: 0, bpm: 120 }], signatures: [],
		tracks: [{ name: 'Long rest', durationFrames: 64_000, notes: [
			{ id: 'n', pitch: 60, velocity: 90, channel: 0, startFrame: 0, durationFrames: 4000 },
		] }] });
	await createMidiImportFiles({ getProject: base.project, importFiles: () => assert.fail('not audio') },
		async () => base.service).importFiles([new File([Uint8Array.from(bytes)], 'Long rest.mid')]);
	assert.ok(validateAudioEditorProjectV17(base.project()));
	assert.equal(base.project().clips[0]?.durationFrames, 64_000);
	let current = base.project();
	let report: DeliveryReport = sealDeliveryReport(createDeliveryReport({ format: 'prior' }));
	const dependencies = { ...base.dependencies, getProject: () => current,
		commit: (...args: Parameters<typeof base.dependencies.commit>) => { const result = base.dependencies.commit(...args); current = base.project(); return result; },
		publishDeliveryReport: (value: DeliveryReport) => { report = value; } };
	return { base, dependencies, service: createMidiService(dependencies), report: () => report,
		current: () => current, replace: (next: typeof current) => { current = next; } };
}

test('successful Allegro export reports unencoded trailing silence and keeps useful notes', async () => {
	const f = await fixture();
	await f.service.exportFile('allegro');
	assert.equal(f.report().subject.format, 'allegro');
	const warning = f.report().items.find(item => item.code === 'ALLEGRO_TRACK_EXTENT_CONVERTED');
	assert.ok(warning);
	assert.equal(warning.disposition, 'converted');
	assert.equal(warning.severity, 'warning');
	assert.deepEqual(warning.data.tracks, [{ name: 'Long rest', durationFrames: 64_000, contentEndFrame: 4000 }]);
	const text = f.base.saves[0]?.text; assert.ok(typeof text === 'string');
	assert.equal(parseAllegroFile(text).tracks[0]?.notes.length, 1);
	await f.service.exportFile('midi');
	assert.equal(f.report().subject.format, 'midi');
	assert.equal(f.report().items.length, 0);
	const bytes = f.base.saves[1]?.bytes; assert.ok(bytes instanceof Uint8Array);
	assert.equal(parseMidiFile(bytes, { sampleRate: 8000 }).tracks.find(track => track.notes.length)?.durationFrames, 64_000);
});

test('a canceled or failed Save leaves the prior report and propagates real failures', async () => {
	for (const result of [undefined, { cancelled: true }, new Error('disk full')]) {
		const f = await fixture(); const prior = f.report();
		f.dependencies.saveFile = () => { if (result instanceof Error) throw result; return result; };
		if (result instanceof Error) await assert.rejects(f.service.exportFile('allegro'), error => error === result);
		else await f.service.exportFile('allegro');
		if (result === undefined) assert.notEqual(f.report(), prior);
		else assert.equal(f.report(), prior);
	}
});

test('report publication waits for Save and stays fenced across project replacements', async () => {
	for (const kind of ['selection', 'revision', 'other-project', 'failure', 'edit'] as const) {
		const f = await fixture(); const prior = f.report();
		let finish: (value?: unknown) => void = () => assert.fail('save not started');
		let fail: (reason?: unknown) => void = () => assert.fail('save not started');
		let started: () => void = () => undefined;
		const saving = new Promise<void>(resolve => { started = resolve; });
		f.dependencies.saveFile = () => new Promise((resolve, reject) => { finish = resolve; fail = reject; started(); });
		const exporting = f.service.exportFile('allegro');
		await saving;
		assert.equal(f.report(), prior);
		const before = f.current();
		const next = kind === 'other-project' || kind === 'failure' ? createAudioEditorProjectV17({ sampleRate: 8000 })
			: { ...before, revision: before.revision + 1 };
		if (kind === 'edit') {
			const clip = before.clips[0]!; const note = readMidiClip(clip)!.notes[0]!;
			await f.service.updateNote(clip.id, note.id, { pitch: note.pitch + 1 });
		} else f.replace(next);
		if (kind === 'selection') f.service.followSelection(before, next);
		if (kind === 'failure') { fail(new Error('late disk failure')); await assert.rejects(exporting, /late disk failure/); }
		else { finish(); await exporting; }
		if (kind === 'selection') assert.notEqual(f.report(), prior);
		else assert.equal(f.report(), prior);
	}
});

test('Allegro extent reports omit ordinary endpoints already encoded by notes or updates', () => {
	const document = { sampleRate: 8000, tempos: [{ frame: 0, bpm: 120 }], signatures: [], tracks: [
		{ name: 'Note end', durationFrames: 4000, notes: [{ id: 'n', pitch: 60, velocity: 90, channel: 0, startFrame: 0, durationFrames: 4000 }] },
		{ name: 'Update end', durationFrames: 8000, notes: [], events: [{ frame: 8000, status: 176, data: [7, 0] }] },
	] };
	assert.equal(midiFileDeliveryReport(document, 'allegro').items.length, 0);
});
