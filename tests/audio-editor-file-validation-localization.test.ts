/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareRawPcmWaveFile } from '../src/common/editor/controller/import/raw-pcm-import.ts';
import { normalizeBextMetadata } from '../src/common/editor/broadcast-wave.ts';
import { parseMacroScriptEnvelope } from '../src/common/editor/macro-script-envelope.ts';
import { importDeliveryPresets } from '../src/common/editor/delivery-preset-store.ts';
import { createRegularIntervalAnnotationCommand } from '../src/common/editor/controller/document/regular-interval-annotation-service.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { presentationFeedbackText, feedbackFailure, feedbackErrorParameter } from '../src/common/editor/ui/presentation-feedback.ts';
import { mountedMacroManagerFixture, macroSnapshot, changeFile } from './helpers/macro-manager-fixture.tsx';
import { formatPresentationMessage } from '../src/common/i18n/presentation-message.ts';

void test('raw PCM offset at the end of an actual file reports a localized incomplete-frames failure', async () => {
	const file = new File([new Uint8Array(4)], 'authored.raw');
	const error = await failure(() => prepareRawPcmWaveFile(file, { sampleFormat: 'int16', byteOrder: 'little', sampleRate: 48_000, channelCount: 1, offsetBytes: 4 }));
	assert.ok(error instanceof RangeError);
	assert.match(error.message, /complete interleaved frames/u, 'original diagnostic retained');
	assert.equal(presentationFeedbackText(feedbackFailure(error), { 'ui.fileValidation.rawIncompleteFrames': 'Unvollständige PCM-Frames' }), 'Unvollständige PCM-Frames');
});

test('BEXT user loudness bounds report a translated field label with numeric bounds', () => {
	const error = caught(() => normalizeBextMetadata({ loudnessValue: 9999 }));
	assert.ok(error instanceof RangeError); assert.match(error.message, /loudnessValue/u);
	assert.equal(presentationFeedbackText(feedbackFailure(error), { 'ui.fileValidation.bextBounds': '{field}: {minimum} bis {maximum}', bextLoudnessValue: 'Integrierte Lautheit' }), 'Integrierte Lautheit: -99.99 bis 99.99');
});

test('macro program JSON errors localize inside the existing outer failure template, including SyntaxError causes', () => {
	for (const source of ['{}', '{']) {
		const error = caught(() => parseMacroScriptEnvelope(source));
		const parameter = feedbackErrorParameter(error);
		assert.equal(formatPresentationMessage({ failure: 'Import: {message}', 'ui.fileValidation.macroInvalidProgram': 'Ungültige Programmdatei', 'ui.fileValidation.macroInvalidJson': 'Ungültiges JSON' },
			{ key: 'failure', parameters: { message: parameter } }), source === '{}' ? 'Import: Ungültige Programmdatei' : 'Import: Ungültiges JSON');
	}
});

test('empty export preset libraries retain RangeError but display localized import guidance', () => {
	const error = caught(() => importDeliveryPresets({}, '{"schemaVersion":1,"presets":[]}'));
	assert.ok(error instanceof RangeError);
	assert.equal(presentationFeedbackText(feedbackFailure(error), { 'ui.fileValidation.exportPresetEmpty': 'Keine Exportvorlagen enthalten' }), 'Keine Exportvorlagen enthalten');
});

test('a user requested regular marker count above capacity has localized limit guidance', () => {
	const project = createCurrentAudioEditorProject({ id: 'regular-localization' });
	const error = caught(() => createRegularIntervalAnnotationCommand(project, { kind: 'marker', anchor: 'sample', sequenceId: project.primarySequenceId,
		startFrame: 0, endFrame: 4097, intervalFrames: 1, namePrefix: 'Authored $&', color: 'auto' }, prefix => prefix));
	assert.ok(error instanceof RangeError);
	assert.equal(presentationFeedbackText(feedbackFailure(error), { 'ui.fileValidation.annotationCapacity': 'Höchstens {maximum} Markierungen' }), 'Höchstens 4096 Markierungen');
});

function caught(operation: () => unknown): Error {
	try { operation(); } catch (error) { assert.ok(error instanceof Error); return error; } throw new Error('Expected validation failure');
}
async function failure(operation: () => Promise<unknown>): Promise<Error> {
	try { await operation(); } catch (error) { assert.ok(error instanceof Error); return error; } throw new Error('Expected validation failure');
}

void test('Macro Manager file-size guard uses translated-message presentation without reading an oversized file', async () => {
	const fixture = await mountedMacroManagerFixture(); let reads = 0;
	try {
		await fixture.render(macroSnapshot('project'));
		await changeFile(fixture.importScriptInput(), { name: 'Oversized.soundscapemacro', size: 2097153, text: async () => { reads++; return '{}'; } } as File);
		assert.equal(reads, 0);
		assert.match(fixture.message() ?? '', /Macro program files must contain at most 2097152 bytes/u);
	} finally { fixture.settlePending(); await fixture.cleanup(); }
});
