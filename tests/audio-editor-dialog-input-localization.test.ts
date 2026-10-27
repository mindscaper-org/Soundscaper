/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAudioWarpRational, parseAudioWarpGrooveOffsets, parseVideoRetimeRational,
	parseFinishingNoiseProfile, noiseProfileFailure } from '../src/common/editor/ui/dialogs/dialog-input-validation.ts';
import { presentationFeedbackText, feedbackFailure } from '../src/common/editor/ui/presentation-feedback.ts';
import { createFramescaperFinishingCommand, importFramescaperCaptionSidecar } from '../src/common/editor/ui/framescaper-finishing-dialog-model.ts';
import { createFramescaperDialogueChain } from '../src/framescaper/editor-audio-dialogue-chain-finishing.ts';
import { prepareFramescaperSelectedVisualAuthoringFinishing } from '../src/framescaper/editor-selected-finishing-visual-authoring-commands.ts';
import { createFramescaperSelectedVisualAuthoringFenceFinishing } from '../src/framescaper/editor-selected-finishing-visual-authoring-model.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import type { AudioEditorProjectStore } from '../src/common/editor/storage.js';

const text = (error: unknown, copy: Record<string, string>) => presentationFeedbackText(feedbackFailure(error), copy);
test('the actual warp field parsers localize names and preserve invalid authored dollar/braces text literally', () => {
	const value = '$& {field}'; const error = caught(() => parseAudioWarpRational(value, 'marker source'));
	assert.ok(error instanceof TypeError);
	assert.equal(text(error, { 'ui.fileValidation.audioWarpFraction': '{field}: {value}', 'ui.fileValidation.audioWarpSource': 'Quell-Sample' }), `Quell-Sample: ${value}`);
	assert.equal(text(caught(() => parseAudioWarpGrooveOffsets('')), { 'ui.fileValidation.audioWarpGrooveSize': '{minimum} bis {maximum} Versätze' }), '1 bis 128 Versätze');
});
test('the retime Freeze/Ramp parser localizes a zero-denominator refusal without changing admitted fractions', () => {
	const error = caught(() => parseVideoRetimeRational('1/0', 'freeze source frame'));
	assert.ok(error instanceof RangeError);
	assert.equal(text(error, { 'ui.fileValidation.videoRetimeFraction': '{field}: positiver Nenner erforderlich', 'ui.videoRetime.videoRetimeSourceFrame': 'Quellbild' }), 'Quellbild: positiver Nenner erforderlich');
	assert.deepEqual(parseVideoRetimeRational('-1/3', 'start velocity'), { num: -1, den: 3 });
});
test('noise-profile JSON and actual unsupported captured-profile validation use the noise-profile family', () => {
	const syntax = caught(() => parseFinishingNoiseProfile('{'));
	assert.ok(syntax instanceof SyntaxError); assert.ok(syntax.cause instanceof Error);
	assert.equal(text(syntax, { 'ui.fileValidation.noiseProfileJson': 'Ungültiges Rauschprofil-JSON' }), 'Ungültiges Rauschprofil-JSON');
	const unsupported = caught(() => createFramescaperDialogueChain({ id: 'chain', sampleRate: 48_000, noiseReduction: { profile: parseFinishingNoiseProfile('{}') } }));
	assert.equal(text(noiseProfileFailure(unsupported), { 'ui.fileValidation.noiseProfileInvalid': 'Ungültiges aufgenommenes Rauschprofil' }), 'Ungültiges aufgenommenes Rauschprofil');
});
test('actual captions and finishing-document parsers keep diagnostics beside localized primary families', () => {
	const project = { schemaFamily: 'framescaper', schemaVersion: 1, sampleRate: 48_000, videoCaptionTracks: [], primarySequenceId: 'sequence', sequences: [{ id: 'sequence' }] };
	const sidecar = caught(() => importFramescaperCaptionSidecar({ project, format: 'srt', text: 'bad sidecar', trackId: 'captions', sequenceId: 'sequence', trackName: 'Authored $&', language: 'de' }));
	assert.match(sidecar.message, /SRT/u);
	assert.equal(text(sidecar, { 'ui.fileValidation.finishingCaption': '{format}-Untertitel sind ungültig' }), 'SRT-Untertitel sind ungültig');
	const document = caught(() => createFramescaperFinishingCommand('captions', project, '{'));
	assert.ok(document instanceof SyntaxError);
	assert.equal(text(document, { 'ui.fileValidation.finishingDocument': 'Ungültiges Bearbeitungsdokument' }), 'Ungültiges Bearbeitungsdokument');
});
void test('the real selected mask authoring command reports localized finite bounds for an emptied Width field', async () => {
	const source = createVideoSource({ id: 'source', name: 'Authored', storageKey: 'source', mimeType: 'video/mp4', contentSha256: 'ab'.repeat(32),
		sampleFrameCount: 16_000, sourceFrameCount: 10, frameRate: { num: 30, den: 1 }, width: 640, height: 360 });
	const project = { schemaFamily: 'framescaper', schemaVersion: 1, id: 'project', revision: 0, sampleRate: 48_000, selection: { clipIds: ['clip'] },
		primarySequenceId: 'sequence', sequences: [{ id: 'sequence', trackIds: ['track'], rate: { num: 30, den: 1 } }], tracks: [{ id: 'track', type: 'video', clipIds: ['clip'] }],
		clips: [{ id: 'clip', kind: 'video', sourceId: source.id, sequenceId: 'sequence', sequenceStartFrame: 0, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null }],
		sources: [source], videoVisualPresentations: [], videoMaskMattes: [], videoVisualPresets: [], videoFinishingPresets: [], videoAdjustmentLayers: [], videoFreezeFallbacks: [], trackFolders: [] };
	const fence = createFramescaperSelectedVisualAuthoringFenceFinishing({ project, selectedClipId: 'clip', playheadSample: 0 });
	let error: unknown;
	try { await prepareFramescaperSelectedVisualAuthoringFinishing({ surface: 'video-mask-matte', project, store: {} as AudioEditorProjectStore,
		request: { fence, clipId: 'clip', operation: 'apply', maskId: null, shape: 'rectangle', width: NaN, height: 0.75 } }); } catch (cause) { error = cause; }
	assert.ok(error instanceof RangeError); assert.match(error.message, /mask width/u);
	assert.equal(text(error, { 'ui.fileValidation.visualBounds': '{field}: {minimum} bis {maximum}', 'ui.selectedVisualAuthoring.width': 'Breite' }), 'Breite: 0.01 bis 1');
});
function caught(operation: () => unknown): Error { try { operation(); } catch (error) { assert.ok(error instanceof Error); return error; } throw new Error('Expected input failure'); }
