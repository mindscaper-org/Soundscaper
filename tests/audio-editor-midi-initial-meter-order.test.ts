/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { midiDocumentFromProject } from '../src/common/editor/midi-project-interchange.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { midiControllerPcmFixture } from './helpers/midi-controller-pcm-fixture.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { initialMeterMidi } from './helpers/midi-initial-meter-fixture.ts';

function expectedSignatures(sampleRate: number) {
	return [{ frame: 0, numerator: 4, denominator: 4, clocksPerMetronomeClick: 36, notated32ndNotesPerQuarter: 12 },
		{ frame: sampleRate / 2, numerator: 6, denominator: 8, clocksPerMetronomeClick: 72 }];
}

test('File Import adopts the final initial MIDI meter and retains it through project save', async t => {
	const { controller, store } = await midiControllerPcmFixture();
	t.after(async () => { await controller.dispose(); });
	await controller.actions.project.importFiles([new File([initialMeterMidi()], 'Initial meters.mid')]);
	assert.deepEqual(controller.project?.tempo.timeSignature, { numerator: 4, denominator: 4 });
	await controller.actions.project.save();
	const saved: unknown = await store.loadProject(controller.project!.id);
	assert.ok(validateAudioEditorProjectV17(saved));
	assert.deepEqual(midiDocumentFromProject(saved).signatures, expectedSignatures(saved.sampleRate));
});

for (const options of [{}, { sameMeter: true }, { obsolete: false }]) {
	test(`MIDI delivery preserves the active initial meter clocks and later changes ${JSON.stringify(options)}`, async () => {
		const fixture = midiServiceFixture();
		const document = parseMidiFile(initialMeterMidi(options), { sampleRate: 8000 });
		await fixture.service.importDocument(document);
		// The user can explicitly select the already-active meter before exporting.
		fixture.apply({ type: 'tempo/set', numerator: 4, denominator: 4 });
		const restored: unknown = JSON.parse(JSON.stringify(fixture.project()));
		assert.ok(validateAudioEditorProjectV17(restored));
		const exported = midiDocumentFromProject(restored);
		assert.deepEqual(exported.signatures, expectedSignatures(8000));
		assert.deepEqual(parseMidiFile(writeMidiFile(exported), { sampleRate: 8000 }).signatures, expectedSignatures(8000));
		assert.equal(exported.tracks[0]?.notes[0]?.durationFrames, 8000);
		assert.deepEqual(document.signatures.map(signature => signature.numerator), options.obsolete === false ? [4, 6] : [options.sameMeter ? 4 : 3, 4, 6]);
	});
}

test('imported origin declarations do not replace an existing project meter or add obsolete future changes', async () => {
	const fixture = midiServiceFixture();
	await fixture.service.addTrack();
	fixture.apply({ type: 'tempo/set', numerator: 5, denominator: 4 });
	await fixture.service.importDocument(parseMidiFile(initialMeterMidi(), { sampleRate: 8000 }));
	assert.deepEqual(fixture.project().tempo.timeSignature, { numerator: 5, denominator: 4 });
	assert.deepEqual(midiDocumentFromProject(fixture.project()).signatures, [{ frame: 0, numerator: 5, denominator: 4 }]);
});
