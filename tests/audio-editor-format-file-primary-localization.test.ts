/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { readDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { readScapeArchiveEnvelope } from '../src/common/editor/scape-archive-envelope.ts';
import { validateScapeArchiveLayout } from '../src/common/editor/scape-archive-layout.ts';
import { assertAudacitySerializedDatabaseHeader } from '../src/common/editor/aup4-database.js';
import { Aup4WorkerClient } from '../src/common/editor/aup4-client.js';
import { decodeAuBlockFile, decodeLegacyAupProject } from '../src/common/editor/aup-legacy.js';
import { parseAudioEditorCueSheet } from '../src/common/editor/cue-import.ts';
import { createEdlExport } from '../src/common/editor/edl-export.ts';
import { openWorkspaceProjectFile } from '../src/common/editor/ui/workspace/open-workspace-project-file.ts';
import { workspaceErrorMessage } from '../src/common/editor/ui/workspace/workspace-error-presentation.ts';
import { publishImportFailureStatus } from '../src/common/editor/controller/import/internal/import-status-localization.ts';
import { formatFileFailure } from '../src/common/editor/format-file-failure.ts';
import { FORMAT_FILE_FAILURE_COPY } from '../src/common/i18n/editor-format-file-failure-copy.ts';
import { EDITOR_ENGLISH_COPY } from '../src/common/i18n/editor-copy-inventory.ts';

const german = { genericError: 'Fehlgeschlagen: {message}', unknownError: 'Unbekannter Fehler', importSummary: '{successes} importiert, {failures} fehlgeschlagen.',
	...Object.fromEntries(Object.keys(FORMAT_FILE_FAILURE_COPY).map((key) => [`ui.formatFileFailure.${key}`, `Deutsche Erklärung ${key}`])) };
async function failure(action: () => unknown | Promise<unknown>): Promise<Error> {
	try { await action(); } catch (error) { assert.ok(error instanceof Error); return error; }
	throw new Error('Expected format admission to refuse the file.');
}
function assertLocalized(error: Error, family: string, key: keyof typeof FORMAT_FILE_FAILURE_COPY): void {
	assert.equal(formatFileFailure(error)?.family, family);
	const canonical = `ui.formatFileFailure.${key}`;
	assert.equal(EDITOR_ENGLISH_COPY[canonical], FORMAT_FILE_FAILURE_COPY[key]);
	assert.equal(workspaceErrorMessage(error, german), `Fehlgeschlagen: Deutsche Erklärung ${key}`);
	assert.equal(workspaceErrorMessage(error, { ...german, [canonical]: 'Explication française' }), 'Fehlgeschlagen: Explication française');
}

test('actual DAWproject XML/archive, Scape layout and SESX capability failures retain diagnostics with localized primary explanations', async () => {
	const xml = await failure(() => parseDawprojectDocument('<NotProject/>'));
	assert.match(xml.message, /<Project>.*<NotProject>/);
	assertLocalized(xml, 'dawproject', 'dawprojectXml');
	assertLocalized(await failure(() => readDawprojectArchive(new Blob(['broken archive']))), 'dawproject', 'dawprojectArchive');
	assertLocalized(await failure(() => validateScapeArchiveLayout(new Blob([new Uint8Array(24)]))), 'scape', 'scapeArchive');
	assertLocalized(await failure(() => readScapeArchiveEnvelope([])), 'scape', 'scapeArchive');
	const unavailable = () => { throw new Error('must not execute desktop import'); };
	const controller = { ready: Promise.resolve(), actions: { project: { openDawproject: unavailable, openAudacityProject: unavailable } } };
	assertLocalized(await failure(() => openWorkspaceProjectFile(controller, new File(['<sesx/>'], 'session.sesx'), unavailable)), 'sesx', 'sesxDesktopRequired');
});

test('actual binary and legacy Audacity admission keeps typed codes and localizes direct and import-summary feedback', async () => {
	const invalid = await failure(() => assertAudacitySerializedDatabaseHeader(new Uint8Array(100)));
	assert.equal((invalid as Error & { code: string }).code, 'INVALID_DATABASE');
	assertLocalized(invalid, 'audacity-database', 'audacityInvalidDatabase');
	const legacy = await failure(() => decodeLegacyAupProject(new File(['<NotProject/>'], 'session.aup'), []));
	assert.equal((legacy as Error & { code: string }).code, 'INVALID_PROJECT_XML');
	assertLocalized(legacy, 'legacy-aup', 'legacyXml');
	const xml = '<project rate="44100"><wavetrack><waveclip><sequence><waveblock><simpleblockfile filename="missing.au" len="4"/></waveblock></sequence></waveclip></wavetrack></project>';
	assertLocalized(await failure(() => decodeLegacyAupProject(new File([xml], 'missing.aup'), [])), 'legacy-aup', 'legacyMissingBlocks');
	assertLocalized(await failure(() => decodeAuBlockFile(new Uint8Array(24))), 'legacy-aup', 'legacyCorruptBlocks');
	let summary = '';
	publishImportFailureStatus((text) => { summary = text; }, german, 0, 1, [{ fileName: 'session.aup', error: legacy }]);
	assert.equal(summary, '0 importiert, 1 fehlgeschlagen.\nsession.aup: Deutsche Erklärung legacyXml');
});

test('worker-reconstructed Audacity codes recover presentation identities without accepting renderer metadata', async () => {
	const listeners = new Map<string, (event: { data: unknown }) => void>();
	const worker = {
		addEventListener: (type: string, listener: (event: { data: unknown }) => void) => { listeners.set(type, listener); },
		removeEventListener: (type: string) => { listeners.delete(type); }, terminate() {},
		postMessage(message: { id: string }) {
			queueMicrotask(() => listeners.get('message')?.({ data: { id: message.id,
				error: { name: 'Aup4Error', code: 'CORRUPT_DATABASE', message: 'SQLite integrity check failed: damaged page4.', details: { page: 4 } } } }));
		},
	};
	const client = new Aup4WorkerClient({ workerFactory: () => worker as unknown as Worker });
	try {
		const error = await failure(() => client.openFile('project', new File([new Uint8Array(100)], 'session.aup3')));
		assert.match(error.message, /page4/);
		assertLocalized(error, 'audacity-database', 'audacityCorruptDatabase');
	} finally { client.dispose(); }
});

test('actual CUE timestamps and CMX frame/event constraints use code-owned translated primary guidance', async () => {
	const cue = await failure(() => parseAudioEditorCueSheet('FILE "song.wav" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:60:00', { sampleRate: 48000 }));
	assert.equal((cue as Error & { code: string }).code, 'INVALID_TIMESTAMP');
	assertLocalized(cue, 'cue', 'cueTimestamp');
	assertLocalized(await failure(() => createEdlExport({ title: 'sequence', rate: { num: 120, den: 1 }, events: [] })), 'edl', 'edlFrameFields');
	const event = { reel: 'SOURCE', trackKind: 'V' as const, sourceInFrames: 0, sourceOutFrames: 1, recordInFrames: 0, recordOutFrames: 1 };
	assertLocalized(await failure(() => createEdlExport({ title: 'sequence', rate: { num: 30, den: 1 }, events: new Array(1000).fill(event) })), 'edl', 'edlEventLimit');
});

test('format presentation retains nested diagnostic custody and leaves cancellation untouched', async () => {
	const { withFormatFileFailure, formatFileFailureMessage } = await import('../src/common/editor/format-file-failure.ts');
	const { errorDiagnosticMessage } = await import('../src/common/editor/error-diagnostic-message.ts');
	const cause = new RangeError('Precise decoder byte offset19.');
	const original = Object.assign(new SyntaxError('Precise XML root failure.', { cause }), { code: 'XML_ROOT', details: Object.freeze({ offset: 19 }) });
	assert.equal(withFormatFileFailure(original, { family: 'dawproject', reason: 'XML_ROOT', message: { key: 'ui.formatFileFailure.dawprojectXml' } }), original);
	assert.equal(original.cause, cause);
	assert.equal(original.code, 'XML_ROOT');
	assert.match(errorDiagnosticMessage(original, ''), /XML root failure.*decoder byte offset19/);
	assertLocalized(original, 'dawproject', 'dawprojectXml');
	for (const cancellation of [new DOMException('cancel', 'AbortError'), new Error('stopped', { cause: new DOMException('cancel', 'AbortError') })]) {
		assert.equal(withFormatFileFailure(cancellation, { family: 'scape', reason: 'ARCHIVE', message: { key: 'ui.formatFileFailure.scapeArchive' } }), cancellation);
		assert.equal(formatFileFailureMessage(cancellation), undefined);
	}
});
