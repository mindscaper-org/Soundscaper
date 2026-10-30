/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { selectTakeCycleStartAdmission } from '../src/common/editor/ui/take-cycle-recording-menu.ts';
import { communityTranslationMessageKeys } from '../src/common/editor/ui/community-translations/community-translation-message-filter.ts';
import { createContributionSnapshot, createTranslationDraft } from '../src/common/i18n/community-translations.ts';
import { serializeExportChannelMatrix, toggleExportChannelMatrix } from '../src/common/editor/ui/export-channel-matrix.ts';
import { projectHasTimelineAudio } from '../src/common/editor/ui/timeline-media-presence.ts';
import { createClipSelectionNavigationMenuModel } from '../src/common/editor/ui/clip-selection-navigation-menu-model.ts';
import { resolveEffectMenuTargeting, createEffectMenuEntries } from '../src/common/editor/ui/effect-menu-organization.js';
import { sourceRulerTicks, clipSourceSegments } from '../src/common/editor/ui/inspector/clip-source-view.ts';
import { meterChannelReadings } from '../src/common/editor/ui/meter-channel-readings.ts';

void test('U03 cycle menu counts sequence membership once per publication, including duplicate IDs within a sequence', t => {
	let reads = 0;
	const tracks = Array.from({ length: 80 }, (_, i) => ({ id: `t${i}`, type: 'audio', armed: true }));
	const sequences = tracks.map(({ id }) => ({ get trackIds() { reads++; return [id, id]; } }));
	const project = { schemaFamily: 'soundscaper', schemaVersion: 1, loop: { enabled: true, startFrame: 0, endFrame: 10 }, tracks, sequences };
	const snapshot = { productId: 'soundscaper', capabilities: { takeComp: true }, project, recordingInputs: { routes: Object.fromEntries(tracks.map(({ id }) => [id, {}])) } };
	assert.equal(selectTakeCycleStartAdmission(snapshot).allowed, true);
	t.diagnostic(`sequence trackIds reads ${reads}`); assert.ok(reads <= 160);
	assert.equal(selectTakeCycleStartAdmission({ ...snapshot, project: { ...project, sequences: [...sequences, sequences[0]] } }).reason, 'routing');
});

void test('U04 translation message filtering indexes draft entries once with first duplicate authority', t => {
	const snapshot = createContributionSnapshot('fr', Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, `Source ${i}`])), {});
	let reads = 0;
	const draft = { ...createTranslationDraft(snapshot), entries: Array.from({ length: 200 }, (_, i) => ({ get key() { reads++; return `k${i}`; }, source: `Source ${i}`, baselineText: '', baselineEntry: null, translation: `Translation ${i}` })) };
	const result = communityTranslationMessageKeys(snapshot, draft, { query: 'Translation', filter: 'all', reviewKeys: new Set(), locale: 'fr' });
	assert.equal(result.length, 200); t.diagnostic(`draft key reads ${reads}`); assert.ok(reads <= 400);
	const duplicate = { ...draft, entries: [{ key: 'k1', source: 'Source 1', baselineText: '', baselineEntry: null, translation: 'first' }, { key: 'k1', source: 'Source 1', baselineText: '', baselineEntry: null, translation: 'second' }] };
	assert.deepEqual(communityTranslationMessageKeys(snapshot, duplicate, { query: 'second', filter: 'all', reviewKeys: new Set(), locale: 'fr' }), []);
});

void test('U10 export matrix serialization partitions retained gains once per output', t => {
	const matrix = Array.from({ length: 32 }, () => [true]);
	let visits = 0; const original = Array.prototype.filter;
	Array.prototype.filter = function<T>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: unknown) {
		if (this.length === 64 && typeof this[0] === 'object' && this[0] !== null && 'gain' in this[0]) visits += this.length;
		return original.call(this, predicate, thisArg) as T[];
	};
	let text: string;
	try { text = serializeExportChannelMatrix(matrix, 1, { channels: [{ inputs: Array.from({ length: 64 }, (_, i) => ({ channel: i % 32, gain: i ? -0.5 : 0 })) }] }); }
	finally { Array.prototype.filter = original; }
	const decoded = JSON.parse(text) as { channels: { inputs: { channel: number; gain: number }[] }[] };
	assert.equal(decoded.channels[0]?.inputs.length, 64); assert.equal(decoded.channels[0]?.inputs[0]?.gain, 0);
	t.diagnostic(`retained contribution filter visits ${visits}`); assert.equal(visits, 0);
});

void test('U11 matrix cell edits copy the edited row and preserve the other frozen rows', () => {
	const matrix = Object.freeze(Array.from({ length: 32 }, () => Object.freeze(Array.from({ length: 32 }, () => false))));
	const result = toggleExportChannelMatrix(matrix, 9, 14, true);
	assert.equal(result[9]?.[14], true); assert.equal(matrix[9]?.[14], false);
	for (let i = 0; i < 32; i++) if (i !== 9) assert.equal(result[i], matrix[i]);
	assert.equal(Object.isFrozen(result[9]), true);
});

void test('U12 timeline media admission skips unrelated clips and short circuits a first match', t => {
	let reads = 0; const clips = Array.from({ length: 500 }, (_, i) => ({ get id() { reads++; return `c${i}`; }, kind: 'audio' }));
	assert.equal(projectHasTimelineAudio({ tracks: [{ type: 'audio', clipIds: ['c0'] }], clips }), true);
	t.diagnostic(`clip identity reads ${reads}`); assert.equal(reads, 1);
	reads = 0; assert.equal(projectHasTimelineAudio({ tracks: [{ type: 'video', clipIds: ['c0'] }], clips }), false); assert.equal(reads, 0);
	assert.equal(projectHasTimelineAudio({ tracks: [{ type: 'audio', clipIds: [undefined] }], clips: [null] }), true);
});

void test('U13 disabled clip navigation never builds audio inventory', () => {
	let reads = 0;
	const actions = { selectNoTracks() {}, selectPreviousClipBoundaryToCursor() {}, selectCursorToNextClipBoundary() {}, selectPreviousClip() {}, selectNextClip() {}, skipToSelectionStart() {}, skipToSelectionEnd() {} };
	const model = createClipSelectionNavigationMenuModel({ blocked: true, copy: {}, project: { tracks: [{ id: 't', type: 'audio', clipIds: ['c'] }], clips: [{ id: 'c', get kind() { reads++; return 'audio'; } }] }, selectedTrackId: 't', selectionActive: true }, actions);
	assert.equal(model.audioClips.items[0]?.disabled, true); assert.equal(model.selectNoTracks.disabled, false); assert.equal(reads, 0);
});

void test('U14 Effect target membership scales linearly with selected tracks', t => {
	let reads = 0; const ids = new Proxy(Array.from({ length: 300 }, (_, i) => `t${i}`), { get(target, key, receiver) { if (/^\d+$/u.test(String(key))) reads++; return Reflect.get(target, key, receiver) as unknown; } });
	const tracks = Array.from({ length: 300 }, (_, i) => ({ id: `x${i}`, type: 'audio', clipIds: ['c'] })); tracks.push({ id: 't299', type: 'audio', clipIds: [] });
	const result = resolveEffectMenuTargeting({ project: { tracks, selection: { trackIds: ids } }, preferences: {}, selectedTrack: null, selectedAudioTrack: null, selectionActive: true, clipSelectionActive: false });
	assert.equal(result.effectAudioTrack?.id, 't299'); t.diagnostic(`selected membership reads ${reads}`); assert.ok(reads <= 300);
});

void test('alphabetical Effect entries preserve locale collation and stable equal-label order', () => {
	const context = { organization: 'sortby:name', copy: {}, effectLabels: new Map([
		['audacity-amplify', 'Ähre'], ['audacity-auto-duck', 'Zebra'],
		['audacity-compressor', 'Alpha'], ['audacity-limiter', 'Alpha'],
	]), productId: 'soundscaper', disabled: false, selectionActive: true, locale: 'sv' };
	const ids = (locale: string) => createEffectMenuEntries({ ...context, locale }, () => {}).map(entry => 'id' in entry ? entry.id : undefined);
	assert.deepEqual(ids('sv'), ['audacity-compressor', 'audacity-limiter', 'audacity-auto-duck', 'audacity-amplify']);
	assert.deepEqual(ids('en'), ['audacity-amplify', 'audacity-compressor', 'audacity-limiter', 'audacity-auto-duck']);
	assert.doesNotThrow(() => createEffectMenuEntries({ ...context, effectLabels: new Map(), locale: 'invalid_locale' }, () => {}));
	assert.doesNotThrow(() => createEffectMenuEntries({ ...context, effectLabels: new Map([['audacity-amplify', 'Only']]), locale: 'invalid_locale' }, () => {}));
	assert.throws(() => ids('invalid_locale'), RangeError);
});

void test('U23 source-ruler ticks compute display precision once per painted ruler', t => {
	let calls = 0; const original = Math.log10; Math.log10 = value => { calls++; return original(value); };
	let result: ReturnType<typeof sourceRulerTicks>;
	try { result = sourceRulerTicks({ startFrame: 0, endFrame: 480_000, width: 8_000, sampleRate: 48_000, originFrame: 0 }); } finally { Math.log10 = original; }
	assert.ok(result.length > 30); assert.equal(result[0]?.label, '0:00.0'); t.diagnostic(`logarithms ${calls}`); assert.equal(calls, 2);
});
void test('U24 stereo meter presentation never slices its channel snapshot', () => {
	let slices = 0; const channels = [{ label: 'L', peak: 0.5, rms: 0 }, { label: 'R', peak: 1, rms: 0 }];
	channels.slice = (...args) => { slices++; return Array.prototype.slice.apply(channels, args) as typeof channels; };
	const result = meterChannelReadings({ strip: { kind: 'master' }, sequence: 1, channelCount: 2, channels, correlation: null, phaseDegrees: null });
	assert.equal(result[1]?.clipped, true); assert.equal(slices, 0);
});

void test('U30 source-editor segment projection avoids spreading discarded flank segments', t => {
	let reads = 0;
	const clip = { id: 'c', sourceId: 's', timelineStartFrame: 0, durationFrames: 100, sourceStartFrame: 0, sourceDurationFrames: 100, get arbitraryMetadata() { reads++; return 'large'; } };
	const result = clipSourceSegments(clip, { frameCount: 100, sampleRate: 48_000 }, 48_000);
	assert.equal(result.length, 1); assert.equal(result[0]?.id, 'c:source'); t.diagnostic(`metadata spreads ${reads}`); assert.equal(reads, 1);
});
