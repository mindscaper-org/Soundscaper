/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAudioEditorLabels } from '../src/common/editor/label-io.js';
import { importAudioEditorEffectPresets, createAudioEditorEffectPresets, isCanonicalAudioEditorEffectPresets } from '../src/common/editor/effect-presets.js';
import { parseAudacityEffectMacro } from '../src/common/editor/effect-macros.js';
import { parseAudacityEffectPreset } from '../src/common/editor/audacity-effect-preset-import.ts';
import { formatFileFailure, formatFileFailureMessage } from '../src/common/editor/format-file-failure.ts';
import { formatPresentationMessage } from '../src/common/i18n/presentation-message.ts';
import { FORMAT_FILE_FAILURE_COPY } from '../src/common/i18n/editor-format-file-failure-copy.ts';
import { presentationFeedbackText, feedbackFailure, feedbackErrorParameter } from '../src/common/editor/ui/presentation-feedback.ts';
import { workspaceErrorMessage } from '../src/common/editor/ui/workspace/workspace-error-presentation.ts';

const copy = { genericError: 'Fehler: {message}', unknownError: 'Unbekannt',
	...Object.fromEntries(Object.keys(FORMAT_FILE_FAILURE_COPY).map((key) => [`ui.formatFileFailure.${key}`, `DE ${key} {line} {parameter}`])) };
function failed(action: () => unknown): Error {
	try { action(); } catch (error) { assert.ok(error instanceof Error); return error; }
	throw new Error('Expected admission refusal.');
}
function check(error: Error, family: string, reason: string): void {
	assert.equal(formatFileFailure(error)?.family, family); assert.equal(formatFileFailure(error)?.reason, reason);
	assert.match(workspaceErrorMessage(error, copy), /^Fehler: DE /);
}

test('TXT/SRT/VTT parser failures retain existing codes and details with a translated primary reason', () => {
	for (const [text, format, reason] of [['0\tText\0', 'txt', 'INVALID_CHARACTER'],
		['WEBVTT\n\ninvalid\nText', 'vtt', 'MISSING_CUE_TIMING'],
		['1\n00:00:05,000 --> 00:00:01,000\nText', 'srt', 'REVERSED_RANGE']] as const) {
		check(failed(() => parseAudioEditorLabels(text, { format, sampleRate: 48000 })), 'labels', reason);
	}
	const encoding = failed(() => parseAudioEditorLabels(new Uint8Array([255]), { format: 'txt' }));
	assert.ok(encoding.cause instanceof Error); check(encoding, 'labels', 'INVALID_UTF8');
});

test('effect preset JSON syntax, schema and record errors keep canonical library custody intact', () => {
	const library = createAudioEditorEffectPresets();
	assert.equal(isCanonicalAudioEditorEffectPresets(library), true);
	check(failed(() => importAudioEditorEffectPresets(library, '{')), 'effect-preset', 'JSON');
	check(failed(() => importAudioEditorEffectPresets(library, '{"schemaVersion":99,"presets":[]}')), 'effect-preset', 'SCHEMA');
	check(failed(() => importAudioEditorEffectPresets(library, '{"schemaVersion":1,"presets":[null]}')), 'effect-preset', 'RECORD');
	check(failed(() => importAudioEditorEffectPresets(library, '{"schemaVersion":1,"presets":[]}')), 'effect-preset', 'EMPTY');
	assert.deepEqual(library.presets, []); assert.equal(isCanonicalAudioEditorEffectPresets(library), true);
});

test('Audacity TXT macro and delegated preset errors expose translated line and parameter identities', () => {
	for (const action of [() => parseAudacityEffectMacro('Amplify:Ratio=oops'),
		() => parseAudacityEffectPreset('Amplify:Ratio=oops')]) {
		const error = failed(action); check(error, 'audacity-preset', 'QUOTED_VALUE');
		assert.match(error.message, /line 1.*Ratio/);
		assert.equal(formatPresentationMessage(copy, formatFileFailureMessage(error)!), 'DE macroQuotedValue 1 Ratio');
	}
	check(failed(() => parseAudacityEffectMacro('Amplify:Ratio="2" Unknown="1"')), 'audacity-preset', 'PARAMETERS');
	check(failed(() => parseAudacityEffectMacro('x'.repeat(1024 * 1024 + 1))), 'audacity-preset', 'SIZE');
});


test('actual preset feedback and Macro Manager outer templates render registry reasons with preserved diagnostic causes', () => {
	const preset = failed(() => importAudioEditorEffectPresets(createAudioEditorEffectPresets(), '{'));
	assert.match(presentationFeedbackText(feedbackFailure(preset), copy), /^DE presetJson/);
	const macro = failed(() => parseAudacityEffectMacro('Amplify:Ratio="2" Unknown="1"'));
	assert.ok(macro.cause instanceof Error);
	assert.equal(presentationFeedbackText({ key: 'macroImportFailed', parameters: { message: feedbackErrorParameter(macro) } },
		{ ...copy, macroImportFailed: 'Makro nicht importiert: {message}' }), 'Makro nicht importiert: DE macroParameters 1 ');
});
