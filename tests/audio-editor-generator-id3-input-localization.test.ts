/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAudioEditorSignalStream } from '../src/common/editor/signal-generator-stream-client.ts';
import { createSignalGeneratorStreamRuntime } from '../src/common/editor/signal-generator-stream-runtime.ts';
import type { OneShotWorkerPort } from '../src/common/editor/one-shot-worker-task.ts';
import { createWavStreamEncoder } from '../src/common/editor/wav.js';
import { createAiffStreamEncoder } from '../src/common/editor/aiff.js';
import { updateId3ProjectField, projectAudioMetadata } from '../src/common/editor/id3-descriptive-fields.ts';
import { workspaceErrorMessage } from '../src/common/editor/ui/workspace/workspace-error-presentation.ts';

void test('actual DTMF worker refusal keeps translated identity across structured clone and cleanup', async () => {
	const worker = new GeneratorWorker(); let failure: unknown;
	try { await generateAudioEditorSignalStream('dtmf', { sequence: 'K', sampleRate: 48_000 }, { workerFactory: () => worker }); } catch (error) { failure = error; }
	assert.ok(failure instanceof RangeError); assert.match(failure.message, /unsupported symbol/u); assert.equal(worker.terminated, true);
	const copy = { genericError: '{message}', unknownError: '?', 'ui.fileValidation.generatorDtmfSymbol': 'Ungültiges DTMF-Zeichen' };
	assert.equal(workspaceErrorMessage(failure, copy), 'Ungültiges DTMF-Zeichen');
});
void test('the visible 24-hour duration at48 kHz refuses oversized generator output before allocating PCM', async () => {
	let failure: unknown;
	try { await generateAudioEditorSignalStream('tone', { durationSeconds: 86400, sampleRate: 48_000 }, { workerFactory: () => new GeneratorWorker() }); } catch (error) { failure = error; }
	const copy = { genericError: '{message}', unknownError: '?', 'ui.fileValidation.generatorOutputTooLarge': 'Die erzeugte Audiodatei ist zu lang' };
	assert.equal(workspaceErrorMessage(failure, copy), 'Die erzeugte Audiodatei ist zu lang');
});
for (const [label, encoder] of [['WAV', createWavStreamEncoder], ['AIFF', createAiffStreamEncoder]] as const) test(`rating300 authored through metadata editing has localized ${label} export refusal before any bytes are written`, () => {
	const metadata = updateId3ProjectField({}, 'rating', '300'); let writes = 0;
	const error = caught(() => encoder({ sampleRate: 48_000, channelCount: 1, totalFrames: 1, metadata: projectAudioMetadata(metadata), collect: false, onChunk: () => { writes++; } }));
	assert.ok(error instanceof RangeError); assert.match(error.message, /0–255/u); assert.equal(writes, 0);
	const copy = { genericError: '{message}', unknownError: '?', 'ui.fileValidation.id3Range': '{field}: {minimum} bis {maximum}', 'ui.id3Metadata.rating': 'Bewertung' };
	assert.equal(workspaceErrorMessage(error, copy), 'Bewertung: 0 bis 255');
	assert.deepEqual(metadata, { tags: { rating: '300' } }, 'the editor retains authored metadata for correction');
});
for (const [key, value, messageKey] of [['commercialUrl', 'javascript:alert(1)', 'id3Url'], ['involvedPeople', 'Singer', 'id3Credits'],
	['comments', 'Text', 'id3Language']] as const) test(`public ${key} metadata export validation localizes its actual field family`, () => {
	let metadata: Readonly<Record<string, unknown>> = updateId3ProjectField({}, key, value);
	if (key === 'comments') metadata = { ...metadata, ...updateId3ProjectField(metadata, 'commentLanguage', 'de') };
	const error = caught(() => createWavStreamEncoder({ sampleRate: 48_000, channelCount: 1, totalFrames: 1, metadata: projectAudioMetadata(metadata) }));
	const copy = { genericError: '{message}', unknownError: '?', [`ui.fileValidation.${messageKey}`]: 'Lokalisierte Metadatenprüfung' };
	assert.equal(workspaceErrorMessage(error, copy), 'Lokalisierte Metadatenprüfung');
});
function caught(operation: () => unknown): Error { try { operation(); } catch (error) { assert.ok(error instanceof Error); return error; } throw new Error('Expected invalid metadata'); }
type Listener = Parameters<OneShotWorkerPort['addEventListener']>[1];
class GeneratorWorker implements OneShotWorkerPort {
	readonly listeners = new Map<string, Set<Listener>>(); readonly handle = createSignalGeneratorStreamRuntime(); terminated = false;
	addEventListener(type: string, listener: Listener): void { const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type, set); }
	removeEventListener(type: string, listener: Listener): void { this.listeners.get(type)?.delete(listener); }
	postMessage(request: unknown): void { queueMicrotask(() => { if (this.terminated) return; const data = structuredClone(this.handle(structuredClone(request)));
		for (const listener of this.listeners.get('message') ?? []) listener({ data }); }); }
	terminate(): void { this.terminated = true; }
}

test('malformed metadata URL syntax retains its native TypeError and localized URL family', () => {
	const metadata = updateId3ProjectField({}, 'commercialUrl', 'not-a-url');
	const error = caught(() => createWavStreamEncoder({ sampleRate: 48_000, channelCount: 1, totalFrames: 1, metadata: projectAudioMetadata(metadata) }));
	assert.ok(error instanceof TypeError);
	const copy = { genericError: '{message}', unknownError: '?', 'ui.fileValidation.id3Url': 'Ungültige URL' };
	assert.equal(workspaceErrorMessage(error, copy), 'Ungültige URL');
});
for (const [field, value, key] of [['commercialReceivedAs', '9', 'id3Range'], ['ownershipDate', '20260230', 'id3Date']] as const) test(`authored ${field} validates with its public translated field name`, () => {
	let metadata: Readonly<Record<string, unknown>> = {};
	for (const [name, text] of [['ownershipSeller', 'Authored seller'], ['ownershipPrice', 'EUR12.99'], ['ownershipDate', '20261026'],
		['commercialPrice', 'EUR12.99'], ['commercialContactUrl', 'https://example.com'], ['commercialValidUntil', '20261026'], [field, value]]) {
		metadata = { ...metadata, ...updateId3ProjectField(metadata, name!, text!) };
	}
	const error = caught(() => createWavStreamEncoder({ sampleRate: 48_000, channelCount: 1, totalFrames: 1, metadata: projectAudioMetadata(metadata) }));
	const copy = { genericError: '{message}', unknownError: '?', [`ui.fileValidation.${key}`]: '{field}: ungültiger Wert', [`ui.id3Metadata.${field}`]: 'Öffentlicher Feldname' };
	assert.equal(workspaceErrorMessage(error, copy), 'Öffentlicher Feldname: ungültiger Wert');
});
