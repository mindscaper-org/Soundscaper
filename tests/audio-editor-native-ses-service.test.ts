/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import type { NativeProjectFileService, NativeProjectServiceRuntime } from '../src/common/editor/controller/document/native-project-types.ts';
import { registerDesktopReadCapability } from '../src/common/editor/desktop-read-capability-registry.ts';
import { validateCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import type { SesxImportReport } from '../src/common/editor/sesx-import-project.ts';
import { formatPresentationMessage, type LocalizedPresentationMessage } from '../src/common/i18n/presentation-message.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';
import { createSesFixture } from './helpers/ses-fixture.ts';

const SESSION_ID = 'b'.repeat(64);

function sessionFile(bytes = createSesFixture()): File {
	const file = new File([Uint8Array.from(bytes)], 'Legacy.ses', { type: 'application/octet-stream' });
	registerDesktopReadCapability(file, SESSION_ID);
	return file;
}

function desktopFixture(options: Readonly<{ missing?: boolean; relink?: boolean; mismatch?: boolean;
	overrides?: Partial<NativeProjectServiceRuntime> }> = {}) {
	const audio = new Blob([encodeWav([new Float32Array(48_000).fill(.25)], {
		sampleRate: options.mismatch ? 44_100 : 48_000, float: true,
	}) as Uint8Array<ArrayBuffer>]);
	const lookups: Array<{ relativePath: string; mediaRootId?: string }> = [];
	const released: string[] = [];
	let reads = 0, folders = 0, ids = 0;
	const fileService: NativeProjectFileService = {
		isDesktop: true,
		async resolveSesxMedia({ relativePath, mediaRootId }) {
			lookups.push({ relativePath, ...(mediaRootId ? { mediaRootId } : {}) });
			if (options.missing || (options.relink && !mediaRootId)) return { status: 'missing' };
			return { status: 'found', descriptor: { id: 'c'.repeat(64), name: relativePath,
				readProfile: 'linked-audio-range-v1', size: audio.size, lastModified: 0, mimeType: 'audio/wav',
				url: 'soundscaper-app://bundle/_desktop/read/linked-audio-range-v1/voice' } };
		},
		async chooseSesxMediaFolder() {
			folders += 1;
			return options.missing ? { status: 'cancelled' } : { status: 'selected', mediaRootId: 'media-root' };
		},
		async withReadDescriptors<Value>(_descriptors: readonly unknown[], _request: unknown,
			consume: (blobs: readonly Blob[]) => Value | PromiseLike<Value>): Promise<Value> {
			reads += 1;
			return consume([audio]);
		},
		async releaseSesxSession(id) { released.push(id); return true; },
		chooseSaveTarget: async () => ({ browserDownload: true }),
		prepareSave: async (request) => ({ mode: 'blob', fileName: request.suggestedName, target: { browserDownload: true } }),
		saveFile: async (request) => ({ fileName: request.suggestedName, size: request.blob.size }),
	};
	const fixture = createFixture({ fileService, createStableId: (prefix) => `${prefix}-${++ids}`, ...options.overrides });
	return { fixture, lookups, released, reads: () => reads, folders: () => folders,
		service: createNativeProjectService(fixture.runtime) };
}

test('desktop File Open imports legacy session audio with original offsets and an explicit partial-import report', async () => {
	const desktop = desktopFixture({ relink: true });
	const result = await desktop.service.openSesx(sessionFile());
	assert.ok(result);
	assert.equal(result.project.title, 'Legacy');
	assert.equal(result.project.sources.length, 1);
	assert.equal(result.project.clips.length, 1);
	const imported: unknown = result.project;
	assert.ok(validateCurrentAudioEditorProject(imported));
	assert.equal(imported.clips[0]?.timelineStartFrame, 4800);
	assert.equal(imported.clips[0]?.sourceStartFrame, 2400);
	assert.equal(imported.clips[0]?.durationFrames, 9600);
	assert.deepEqual(desktop.lookups, [{ relativePath: 'Voice.wav' }, { relativePath: 'Voice.wav', mediaRootId: 'media-root' }]);
	assert.equal(desktop.reads(), 1);
	assert.equal(desktop.folders(), 1);
	assert.deepEqual(desktop.released, [SESSION_ID]);
	assert.deepEqual(desktop.fixture.switched, [result.project.id]);
	const report = result.report as SesxImportReport;
	assert.equal(report.subject.format, 'ses');
	assert.ok(report.items.some((item) => item.severity === 'warning'));
	assert.equal(desktop.fixture.state.importing, false);
	assert.match(desktop.fixture.statuses.at(-1)?.message ?? '', /Delivery Report/u);
});

test('cancelled legacy media relinking reports missing sources without creating playable clips', async () => {
	const desktop = desktopFixture({ missing: true });
	const result = await desktop.service.openSesx(sessionFile());
	assert.ok(result);
	assert.equal(result.project.clips.length, 0);
	assert.equal(result.project.sources.length, 0);
	assert.equal(desktop.reads(), 0);
	assert.ok((result.report as SesxImportReport).items.some((item) => item.code === 'ses.media-missing'));
	assert.deepEqual(desktop.released, [SESSION_ID]);
});

test('legacy success reuses localized session and menu messages with retained translation identities', async () => {
	const copy = { ...createFixture().runtime.copy, sesxOpened: 'Session Audition importée.',
		fileMenu: 'Fichier', deliveryReport: 'Rapport de livraison' };
	const statuses: Array<{ message: string; localization?: LocalizedPresentationMessage }> = [];
	const desktop = desktopFixture({ overrides: { copy, setStatus: (message, state, localization) => {
		if (state === 'success') statuses.push({ message, localization });
	} } });
	await desktop.service.openSesx(sessionFile());
	const status = statuses.at(-1);
	assert.ok(status);
	assert.equal(status.message, 'Session Audition importée. Fichier > Rapport de livraison');
	assert.ok(status.localization);
	assert.equal(status.localization.key, 'sesxOpened');
	assert.equal(formatPresentationMessage({ ...copy, sesxOpened: 'Audition-Sitzung importiert.',
		fileMenu: 'Datei', deliveryReport: 'Auslieferungsbericht' }, status.localization),
	'Audition-Sitzung importiert. Datei > Auslieferungsbericht');
});

test('unrecognized or truncated legacy sessions preserve the current project and release their session grant', async () => {
	for (const body of [new Uint8Array(12), createSesFixture().subarray(0, 30),
		createSesFixture({ clips: [{ startFrame: 0 }, { startFrame: 4800 }] })]) {
		const desktop = desktopFixture();
		await assert.rejects(desktop.service.openSesx(sessionFile(body)), /COOLNESS|truncated|length|size|overlap/iu);
		assert.deepEqual(desktop.fixture.switched, []);
		assert.deepEqual(desktop.lookups, []);
		assert.deepEqual(desktop.released, [SESSION_ID]);
		assert.equal(desktop.fixture.state.importing, false);
	}
});

test('legacy staging failures roll back previously staged sources before releasing the grant', async () => {
	let preflights = 0;
	const desktop = desktopFixture({ overrides: {
		preflightStorage: async () => { if (++preflights === 2) throw new Error('quota changed'); },
	} });
	const file = sessionFile(createSesFixture({ files: [{ id: 1000, path: 'Voice.wav' }, { id: 2000, path: 'Other.wav' }],
		clips: [{ fileId: 1000 }, { fileId: 2000, handle: 2, startFrame: 24_000 }] }));
	await assert.rejects(desktop.service.openSesx(file), /quota changed/u);
	assert.equal(desktop.fixture.deletedSources.length, 1);
	assert.deepEqual(desktop.fixture.switched, []);
	assert.deepEqual(desktop.released, [SESSION_ID]);
	assert.equal(desktop.fixture.state.importing, false);
});

test('legacy import requires desktop selection and skips mismatched audio with a report', async () => {
	const desktop = desktopFixture({ mismatch: true });
	await assert.rejects(desktop.service.openSesx(new File(['COOLNESS'], 'Legacy.ses')), /File.*Open|capability/iu);
	await assert.rejects(createNativeProjectService(createFixture().runtime).openSesx(sessionFile()), /desktop/iu);
	const result = await desktop.service.openSesx(sessionFile());
	assert.ok(result);
	assert.equal(result.project.clips.length, 0);
	assert.ok((result.report as SesxImportReport).items.some((item) => item.code === 'ses.sample-rate-mismatch'));
	assert.deepEqual(desktop.released, [SESSION_ID]);
});
