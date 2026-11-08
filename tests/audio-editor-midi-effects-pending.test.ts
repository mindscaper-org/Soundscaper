/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiEffectsFixture } from './helpers/midi-effects-pending-fixture.ts';
import { settle } from './helpers/async-test-control.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';

function assertRequestedPitch(samples: Float32Array): void {
	const crossings: number[] = [];
	for (let frame = 1000; frame < 3500; frame++) {
		if (samples[frame - 1]! <= 0 && samples[frame]! > 0) crossings.push(frame);
	}
	assert.ok(crossings.length > 10);
	const frequency = (crossings.length - 1) * 48_000 / (crossings.at(-1)! - crossings[0]!);
	assert.ok(Math.abs(frequency - 391.9954) < 1, `expected requested G4, received ${frequency} Hz`);
}

for (const pending of [false, true]) test(`Invert captures the ${pending ? 'pending' : 'settled'} note and publishes signed inverted PCM`, async t => {
	const f = await midiEffectsFixture(t);
	let updating: Promise<unknown> | undefined;
	if (pending) ({ updating } = await f.pendingNote());
	else await f.controller.actions.midi.updateNote(f.clipId, 'note', { pitch: 67 });
	const applying = Promise.resolve(f.controller.actions.effects.applySelection({ type: 'audacity-invert' }));
	void applying.catch(() => {});
	if (pending) {
		await settle();
		assert.equal(f.inputs.length, 0, 'PCM cannot be captured before the earlier edit publishes');
		f.release.resolve();
	}
	await Promise.all([updating, applying]);
	const input = f.inputs[0]; assert.ok(input); assertRequestedPitch(input);
	const output = await f.samples();
	assert.equal(output.length, input.length);
	for (let frame = 0; frame < input.length; frame++) assert.equal(output[frame]! + input[frame]!, 0);
	assert.equal(f.controller.getSnapshot().effects.lastSelectionType, 'audacity-invert');
});

for (const cancel of ['preview', 'apply'] as const) test(`Cancel ${cancel} retires queued PCM without canceling the note`, async t => {
	const f = await midiEffectsFixture(t), { updating } = await f.pendingNote();
	const applying = Promise.resolve(cancel === 'preview'
		? f.controller.actions.effects.previewSelection()
		: f.controller.actions.effects.applySelection({ type: 'audacity-invert' }));
	void applying.catch(() => {});
	if (cancel === 'preview') await f.controller.actions.effects.cancelPreview();
	else await f.controller.actions.effects.cancelSelection();
	await assert.rejects(applying, { name: 'AbortError' });
	f.release.resolve(); await updating;
	assert.equal(f.inputs.length, 0);
	assert.equal(readMidiClip(f.controller.project?.clips.find(clip => clip.id === f.clipId))?.notes[0]?.pitch, 67);
});

for (const cancel of [false, true]) test(`Amplify ${cancel ? 'cancellation' : 'editable defaults'} preserves pending preparation ownership`, async t => {
	const f = await midiEffectsFixture(t), { updating } = await f.pendingNote({ velocity: 50, pitch: 67 });
	const preparing = f.controller.actions.effects.setSelectionType('audacity-amplify');
	void Promise.resolve(preparing).catch(() => {});
	assert.equal(f.controller.getSnapshot().effects.selectionType, 'audacity-amplify', 'pure dialog setup remains immediate');
	await settle(); assert.equal(f.inputs.length, 0);
	if (cancel) await f.controller.actions.effects.cancelPreview();
	else f.controller.actions.effects.setSelectionParams({ gainDb: 6 });
	f.release.resolve(); await updating;
	if (cancel) {
		await assert.rejects(Promise.resolve(preparing), { name: 'AbortError' });
		assert.equal(f.inputs.length, 0);
	} else {
		assert.equal((await preparing).gainDb, 6, 'the scan cannot overwrite an edit made during the MIDI wait');
		const input = f.inputs[0]; assert.ok(input); assertRequestedPitch(input);
	}
});

test('Amplify computes an untouched default from the new note velocity', async t => {
	const f = await midiEffectsFixture(t), { updating } = await f.pendingNote({ velocity: 50, pitch: 67 });
	const preparing = f.controller.actions.effects.setSelectionType('audacity-amplify');
	f.release.resolve(); await updating;
	const params = await preparing, input = f.inputs[0]; assert.ok(input); assertRequestedPitch(input);
	const peak = input.reduce((value, sample) => Math.max(value, Math.abs(sample)), 0);
	assert.ok(Math.abs(Number(params.gainDb) - 20 * Math.log10(1 / peak)) < .1);
});

for (const target of ['timeline', 'source'] as const) test(`changing the ${target} selection retires pending effect capture`, async t => {
	const f = await midiEffectsFixture(t);
	const other = await f.controller.actions.midi.addTrack();
	f.controller.actions.timeline.selectClip(f.clipId);
	if (target === 'source') f.controller.actions.effects.setSourceSelection({ clipId: f.clipId, startFrame: 0, endFrame: 4000 });
	const { updating } = await f.pendingNote();
	const applying = Promise.resolve(f.controller.actions.effects.applySelection({ type: 'audacity-invert' }));
	void applying.catch(() => {});
	if (target === 'source') f.controller.actions.effects.setSourceSelection({ clipId: f.clipId, startFrame: 1000, endFrame: 4000 });
	else f.controller.actions.timeline.selectClip(other.clipId);
	f.release.resolve(); await updating;
	await assert.rejects(applying, { name: 'AbortError' }); assert.equal(f.inputs.length, 0);
});

test('Undo remains a foreign authored mutation and cannot be overwritten by queued MIDI or effects', async t => {
	const f = await midiEffectsFixture(t), { updating } = await f.pendingNote();
	const applying = Promise.resolve(f.controller.actions.effects.applySelection({ type: 'audacity-invert' }));
	void applying.catch(() => {});
	await f.controller.actions.edit.undo(); f.release.resolve();
	const outcomes = await Promise.allSettled([updating, applying]);
	assert.ok(outcomes.every(outcome => outcome.status === 'rejected')); assert.equal(f.inputs.length, 0);
});

test('project replacement retires pending effect capture', async t => {
	const f = await midiEffectsFixture(t), { updating } = await f.pendingNote();
	const applying = Promise.resolve(f.controller.actions.effects.applySelection({ type: 'audacity-invert' }));
	void applying.catch(() => {});
	const projectId = f.controller.project?.id; assert.ok(projectId);
	await f.controller.actions.project.close(projectId, { discard: true }); f.release.resolve();
	await Promise.allSettled([updating]); await assert.rejects(applying, { name: 'AbortError' });
	assert.equal(f.inputs.length, 0);
});


test('a Source effect follows owned MIDI source replacement without changing its selected coordinates', async t => {
	const f = await midiEffectsFixture(t);
	f.controller.actions.effects.setSourceSelection({ clipId: f.clipId, startFrame: 1000, endFrame: 3500 });
	const { updating } = await f.pendingNote();
	const applying = Promise.resolve(f.controller.actions.effects.applySelection({ type: 'audacity-invert' }));
	f.release.resolve(); await Promise.all([updating, applying]);
	const input = await f.midiSamples(), output = await f.samples(); assertRequestedPitch(input);
	assert.equal(output.length, input.length);
	for (let frame = 0; frame < input.length; frame++) {
		assert.equal(output[frame], frame >= 1000 && frame < 3500 ? -input[frame]! : input[frame]);
	}
});

test('pending effects wait for the real controller source registry before reading rendered PCM', async t => {
	const f = await midiEffectsFixture(t, true), { updating } = await f.pendingNote();
	const applying = Promise.resolve(f.controller.actions.effects.applySelection({ type: 'audacity-invert' }));
	void applying.catch(() => {});
	f.release.resolve(); await updating; await f.sourceReadEntered.promise; await settle();
	assert.equal(f.inputs.length, 0, 'a committed source is not yet an activated render input');
	f.releaseSourceRead.resolve(); await applying;
	assert.deepEqual(f.readyInputs, [true]);
	const input = f.inputs[0]; assert.ok(input); assertRequestedPitch(input);
	const output = await f.samples();
	for (let frame = 0; frame < input.length; frame++) assert.equal(output[frame]! + input[frame]!, 0);
});

for (const cancel of [false, true]) test(`${cancel ? 'Cancel' : 'Undo'} remains authoritative during source activation`, async t => {
	const f = await midiEffectsFixture(t, true), { updating } = await f.pendingNote();
	const applying = Promise.resolve(f.controller.actions.effects.applySelection({ type: 'audacity-invert' }));
	void applying.catch(() => {});
	f.release.resolve(); await updating; await f.sourceReadEntered.promise;
	if (cancel) await f.controller.actions.effects.cancelSelection();
	else await f.controller.actions.edit.undo();
	f.releaseSourceRead.resolve();
	await assert.rejects(applying);
	assert.equal(f.inputs.length, 0);
});

test('a later owned MIDI source publication is activated before effect capture can use it', async t => {
	const f = await midiEffectsFixture(t, true), { updating } = await f.pendingNote();
	const applying = Promise.resolve(f.controller.actions.effects.applySelection({ type: 'audacity-invert' }));
	f.release.resolve(); await updating; await f.sourceReadEntered.promise;
	await f.controller.actions.midi.updateNote(f.clipId, 'note', { pitch: 69 });
	const latest = f.controller.project?.clips.find(clip => clip.id === f.clipId); assert.ok(latest);
	f.releaseSourceRead.resolve(); await applying;
	assert.deepEqual(f.renderedSourceIds, [latest.sourceId]);
	assert.deepEqual(f.readyInputs, [true]);
	const input = f.inputs[0]; assert.ok(input);
	const crossings: number[] = [];
	for (let frame = 1000; frame < 3500; frame++) if (input[frame - 1]! <= 0 && input[frame]! > 0) crossings.push(frame);
	assert.ok(crossings.length > 10);
	const frequency = (crossings.length - 1) * 48_000 / (crossings.at(-1)! - crossings[0]!);
	assert.ok(Math.abs(frequency - 440) < 1, 'the consumer cannot use unprepared replacement audio');
});
