/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import type { NativeProjectFileService } from '../src/common/editor/controller/document/native-project-types.ts';
import { registerDesktopReadCapability } from '../src/common/editor/desktop-read-capability-registry.ts';
import { writeDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { createProjectAttributionReport } from '../src/common/editor/project-attribution-report.ts';
import { normalizeSourceProvenance } from '../src/common/editor/source-provenance.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';
import { prepareSessionMediaProvenance } from '../src/common/editor/controller/import/internal/imported-source-provenance.ts';

const PICTURE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=';
const PROJECT = '<Project version="1.0"><Application name="Credits" version="1"/><Structure><Track id="voice" name="Voice" contentType="audio"><Channel role="regular"/></Track></Structure>'
	+ '<Arrangement><Lanes timeUnit="seconds"><Lanes track="voice"><Clips><Clip time="0" duration=".01" contentTimeUnit="seconds"><Audio channels="1" sampleRate="48000" duration=".01"><File path="audio/voice.wav"/></Audio></Clip></Clips></Lanes></Lanes></Arrangement></Project>';

for (const format of ['DAWproject', 'SESX', 'SESX virtual media'] as const) test(`${format} File Open carries embedded audio credits and original-file evidence into native Save`, async () => {
	const samples = new Float32Array(480).fill(.25);
	const audio = new Blob([Uint8Array.from(encodeWav([samples], { sampleRate: 48_000, float: true,
		metadata: { artist: 'Source performer', title: 'Field take', id3Artwork: JSON.stringify([{ mimeType: 'image/png',
			pictureType: 3, description: 'Field cover', data: PICTURE }]) } }))]);
	let pcm = new Float32Array(); let released = 0; let ordinal = 0;
	const fixture = createFixture({ adaptAudacityProject: importSoundscaperAudacityProject, createStableId: prefix => `${prefix}-${++ordinal}`,
		store: { estimateStorage: async () => ({ usage: 0, quota: 1e9 }), beginSourceWrite: async () => ({
			write: async channels => { pcm = channels[0]!.slice(); }, commit: async () => undefined, abort: async () => undefined,
		}), deleteSource: async () => undefined },
	});
	const fileService = { ...fixture.runtime.fileService, isDesktop: true,
		resolveSesxMedia: async () => ({ status: 'found', descriptor: { id: 'read', name: 'voice.wav', size: audio.size,
			lastModified: 0, mimeType: 'audio/wav', readProfile: 'linked-audio-range-v1', url: 'soundscaper-app://media/voice' } }),
		chooseSesxMediaFolder: async () => ({ status: 'cancelled' }),
		withReadDescriptors: async (_descriptors, _options, consume) => await consume([format === 'SESX virtual media' ? new class extends Blob {
			override get size(): number { return audio.size; }
			override slice(start?: number, end?: number, type?: string): Blob { return audio.slice(start, end, type); }
		}() : audio]),
		releaseSesxSession: async () => { released++; return true; },
	} satisfies NativeProjectFileService;
	const service = createNativeProjectService({ ...fixture.runtime, fileService });
	const file = format === 'DAWproject'
		? new File([await writeDawprojectArchive({ projectXml: PROJECT, metadataXml: '<MetaData><Artist>Session performer</Artist></MetaData>',
			files: [{ path: 'audio/voice.wav', blob: audio }] })], 'Session.dawproject')
		: new File(['<sesx><session sampleRate="48000" audioChannelType="mono"><tracks><audioTrack><trackParameters><name>Voice</name></trackParameters>'
			+ '<audioClip fileID="0" name="Field take" startPoint="0" endPoint="480" sourceInPoint="0" sourceOutPoint="480"/></audioTrack></tracks></session>'
			+ '<files><file id="0" relativePath="voice.wav"/></files></sesx>'], 'Session.sesx');
	if (format !== 'DAWproject') registerDesktopReadCapability(file, 'a'.repeat(64));
	const opened = await (format !== 'DAWproject' ? service.openSesx(file) : service.openDawproject(file));
	assert.ok(opened); assert.ok(validateSoundscaperProject(opened.project)); assert.deepEqual(pcm, samples);
	assert.equal(released, format !== 'DAWproject' ? 1 : 0);
	const provenance = normalizeSourceProvenance(opened.project.sources[0]?.provenance);
	assert.equal(provenance.classification, 'imported'); const contribution = provenance.contributions[0]; assert.ok(contribution);
	assert.deepEqual(contribution.origin, { kind: 'local-file', originalFileName: 'voice.wav', mimeType: 'audio/wav', byteLength: audio.size, lastModified: null });
	assert.equal(contribution.metadata.normalized.artist, 'Source performer');
	assert.equal(contribution.attachments[0]?.description, 'Field cover');
	assert.equal(contribution.attachments[0]?.byteLength, Buffer.from(PICTURE, 'base64').byteLength);
	assert.equal(createProjectAttributionReport(opened.project).sources[0]?.classification, 'imported');
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		await store.saveProject(opened.project); const saved: unknown = await store.loadProject(opened.project.id);
		assert.ok(validateSoundscaperProject(saved)); assert.deepEqual(saved.sources[0]?.provenance, provenance);
	} finally { await store.close(); }
});

test('optional session metadata failure retains the truthful origin and a warning', async () => {
	const provenance = await prepareSessionMediaProvenance(new Blob(['unknown optional tags']), {
		originalFileName: 'voice.wav', mimeType: 'audio/wav', createContributionId: () => 'voice-import',
	});
	assert.equal(provenance.classification, 'imported'); const contribution = provenance.contributions[0]; assert.ok(contribution);
	assert.equal(contribution.origin.kind, 'local-file'); assert.equal(contribution.warnings.length, 1);
	assert.match(contribution.warnings[0]!, /Metadata inspection failed/u); assert.deepEqual(contribution.metadata.normalized, {});
});

test('Cancel retires held optional session metadata before allocating an origin identity', async () => {
	const abort = new AbortController(); let release!: () => void; let entered!: () => void; let identities = 0;
	const started = new Promise<void>(resolve => { entered = resolve; });
	const pending = prepareSessionMediaProvenance(new Blob(['held metadata']), {
		originalFileName: 'voice.wav', mimeType: 'audio/wav', signal: abort.signal,
		createContributionId: () => { identities++; return 'late-origin'; },
		inspectMetadata: async () => { entered(); await new Promise<void>(resolve => { release = resolve; });
			return { metadata: {}, attachments: [], warnings: [] }; },
	});
	await started; const reason = new DOMException('Cancel session import', 'AbortError'); abort.abort(reason);
	await assert.rejects(pending, error => error === reason); assert.equal(identities, 0);
	release(); await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(identities, 0);
});
