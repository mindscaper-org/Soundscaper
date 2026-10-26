/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { writeDawprojectArchive, readDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { parseXmlDocument, DAWPROJECT_XML_LIMITS, childElement } from '../src/common/editor/dawproject-xml.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createFixture } from './helpers/native-project-service-fixture.ts';

const PROJECT = '<Project version="1.0"><Application name="Credits" version="1"/></Project>';
const CREDITS = { originalArtist: 'Original performer', composer: 'Composer & co.', songwriter: 'Song writer',
	producer: 'Producer', arranger: 'Arranger', genre: 'Genre', copyright: '© Reviewed owner', website: 'https://example.test/credits' };
const FIELDS = ['OriginalArtist', 'Composer', 'Songwriter', 'Producer', 'Arranger', 'Genre', 'Copyright', 'Website'] as const;

function metadataXml(): string {
	return '<MetaData><Title>Credits</Title><Artist>Performer</Artist><Album>Album</Album>'
		+ FIELDS.slice(0, 5).map((field, index) => `<${field}><![CDATA[${Object.values(CREDITS)[index]}]]></${field}>`).join('')
		+ '<Year>2026</Year>' + FIELDS.slice(5).map((field, index) => `<${field}><![CDATA[${Object.values(CREDITS)[index + 5]}]]></${field}>`).join('')
		+ '<Comment>Session notes</Comment></MetaData>';
}

test('File Open DAWproject retains all standard descriptive credits through local Save and reopen', async context => {
	const archive = await writeDawprojectArchive({ projectXml: PROJECT, metadataXml: metadataXml(), files: [] });
	const fixture = createFixture({ adaptAudacityProject: importSoundscaperAudacityProject });
	const opened = await createNativeProjectService(fixture.runtime).openDawproject(new File([archive], 'Credits.dawproject'));
	assert.ok(opened); assert.ok(validateSoundscaperProject(opened.project));
	assert.deepEqual(opened.project.metadata.tags, CREDITS);
	assert.deepEqual([opened.project.metadata.title, opened.project.metadata.artist, opened.project.metadata.album,
		opened.project.metadata.year, opened.project.metadata.comments], ['Credits', 'Performer', 'Album', '2026', 'Session notes']);
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	context.after(async () => { await store.close(); });
	await store.saveProject(opened.project);
	const loaded: unknown = await store.loadProject(opened.project.id); assert.ok(validateSoundscaperProject(loaded));
	assert.deepEqual(loaded.metadata.tags, CREDITS);
});

for (const uppercase of [false, true]) test(`native DAWproject export carries ${uppercase ? 'uppercase aliases' : 'canonical'} descriptive tags`, async () => {
	const tags = Object.fromEntries(Object.entries(CREDITS).map(([key, value]) => [uppercase ? key.toUpperCase() : key, value]));
	const project = createSoundscaperProject({ id: `credits-${uppercase}`, metadata: { tags } });
	const delivered: Blob[] = [];
	const fixture = createFixture({ getProject: () => project, fileService: { isDesktop: false, chooseSaveTarget: async () => null,
		prepareSave: async request => ({ mode: 'blob', fileName: request.suggestedName, target: null }),
		saveFile: async request => { assert.ok(request.blob instanceof Blob); delivered.push(request.blob); return { fileName: request.suggestedName }; } } });
	fixture.replaceProject(project.id); const before = structuredClone(project);
	await createNativeProjectService(fixture.runtime).saveDawproject(); assert.equal(delivered.length, 1);
	const archive = await readDawprojectArchive(delivered[0]!);
	try {
		assert.ok(archive.metadataXml); const metadata = parseXmlDocument(archive.metadataXml, DAWPROJECT_XML_LIMITS);
		assert.deepEqual(FIELDS.map(field => childElement(metadata, field)?.text), Object.values(CREDITS));
	} finally { await archive.close(); }
	assert.deepEqual(project, before);
});
