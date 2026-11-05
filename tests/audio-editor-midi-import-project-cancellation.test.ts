/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiControllerPcmFixture } from './helpers/midi-controller-pcm-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';
import { writeMidiFile } from '../src/common/editor/midi-file.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { isExpectedWorkspaceCancellation } from '../src/common/editor/ui/workspace/scape-open-decision-continuation.ts';

function heldFile() {
	const entered = deferred<void>(), release = deferred<void>();
	const bytes = writeMidiFile({ sampleRate: 48_000, tempos: [], signatures: [], tracks: [{ name: 'Imported melody',
		notes: [{ id: 'note', pitch: 67, startFrame: 0, durationFrames: 2000, velocity: 90, channel: 0 }] }] });
	return { entered, release, file: { name: 'melody.mid', async arrayBuffer() {
		entered.resolve(); await release.promise; return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
	} } };
}

for (const replacement of ['new project', 'authored edit'] as const) test(`MIDI import retired by ${replacement} is an expected workspace cancellation`, async context => {
	const { controller } = await midiControllerPcmFixture();
	const file = heldFile();
	context.after(async () => { file.release.resolve(); await controller.dispose(); });
	const importing = controller.actions.project.importFiles([file.file]);
	const outcome = Promise.allSettled([importing]);
	await file.entered.promise;
	if (replacement === 'new project') await controller.actions.project.create();
	else await controller.actions.project.rename('Authored while reading');
	const current = controller.project;
	file.release.resolve();
	const result = (await outcome)[0]!;
	assert.equal(result.status, 'rejected');
	if (result.status === 'rejected') assert.equal(isExpectedWorkspaceCancellation(result.reason), true);
	assert.strictEqual(controller.project, current);
	assert.equal(controller.project!.clips.length, 0);
});

test('a timeline selection while reading a MIDI file retains the import and its requested position', async context => {
	const { controller } = await midiControllerPcmFixture();
	const file = heldFile();
	context.after(async () => { file.release.resolve(); await controller.dispose(); });
	const importing = controller.actions.project.importFiles([file.file], { timelineStartFrame: 4000 });
	const outcome = Promise.allSettled([importing]);
	await file.entered.promise;
	controller.actions.timeline.setSelection(100, 200);
	file.release.resolve();
	const result = (await outcome)[0]!;
	assert.equal(result.status, 'fulfilled');
	const clip = controller.project!.clips[0];
	assert.equal(clip?.timelineStartFrame, 4000);
	assert.equal(readMidiClip(clip)?.notes[0]?.pitch, 67);
	assert.equal(controller.project!.selection.startFrame, 100);
	assert.equal(controller.project!.selection.endFrame, 200);
});

test('malformed MIDI remains a visible failure on the unchanged project', async context => {
	const { controller } = await midiControllerPcmFixture();
	context.after(async () => { await controller.dispose(); });
	await assert.rejects(controller.actions.project.importFiles([new File(['invalid'], 'broken.mid')]), error => {
		assert.equal(isExpectedWorkspaceCancellation(error), false);
		return true;
	});
	assert.equal(controller.project!.clips.length, 0);
});

test('a selection after an authored edit cannot revive a pending MIDI import', async context => {
	const { controller } = await midiControllerPcmFixture();
	const file = heldFile();
	context.after(async () => { file.release.resolve(); await controller.dispose(); });
	const importing = controller.actions.project.importFiles([file.file]);
	const outcome = Promise.allSettled([importing]);
	await file.entered.promise;
	await controller.actions.project.rename('Authored revision');
	controller.actions.timeline.setSelection(100, 200);
	const current = controller.project;
	file.release.resolve();
	assert.equal((await outcome)[0]?.status, 'rejected');
	assert.strictEqual(controller.project, current);
});
