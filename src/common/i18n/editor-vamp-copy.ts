/* SPDX-License-Identifier: AGPL-3.0-only */
export const VAMP_DIALOG_COPY = Object.freeze({
	title: 'Vamp Analyzer',
	analyzer: 'Analyzer',
	output: 'Output',
	scope: 'Scope',
	selectedTrack: 'Selected track',
	master: 'Master',
	program: 'Program',
	defaultProgram: 'Default program',
	programValue: 'Program value',
	parameters: 'Parameters',
	analyze: 'Analyze',
	cancel: 'Cancel',
	analyzing: 'Analyzing',
	noAnalyzers: 'No enabled Vamp analyzers are available.',
	feature: 'feature',
	features: 'features',
	labelTrackName: 'Label track name',
	publishLabels: 'Publish labels',
	publishing: 'Publishing labels',
	tooManyLabels: 'This result exceeds the 10,000-label publication limit.',
	publishMidi: 'Create MIDI track',
	midiTrackName: 'MIDI track name',
	midiExplanation: 'Convert detected notes into an editable MIDI track alongside the original audio. Notes keep their timing; velocity defaults to 100.',
	chordMidiExplanation: 'Create MIDI chord voicings from the estimated harmony. These may differ from the notes and articulation originally played.',
});
export const VAMP_COPY = Object.freeze({ ...VAMP_DIALOG_COPY, loadingCatalog: 'Loading enabled Vamp analyzers', catalogFailed: 'Unable to load enabled Vamp analyzers.' });
export const VAMP_COPY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
	"output": "output",
	"selectedTrack": "selectedTrack",
	"master": "master",
	"program": "ui.macroManager.program",
	"parameters": "ui.framescaperNative.ofxParameters",
	"analyze": "shortcutCategoryAnalyze",
	"cancel": "cancel"
});
