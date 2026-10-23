/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { writeDawprojectArchive, readDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

const COMMENT = '\n  Opening: retain the breath.\n\tEnding: let it ring.\n';
const PROJECT = '<Project version="1.0"><Application name="Metadata control" version="1"/></Project>';

for (const comment of [COMMENT, ' Ordinary comment ', 'Ordinary comment']) {
	test(`File Open DAWproject retains exact metadata character data ${JSON.stringify(comment)}`, async () => {
		const archive = await writeDawprojectArchive({ projectXml: PROJECT,
			metadataXml: `<MetaData><Title>Metadata</Title><Comment><![CDATA[${comment}]]></Comment></MetaData>`, files: [] });
		const fixture = createFixture({ adaptAudacityProject: importSoundscaperAudacityProject });
		const opened = await createNativeProjectService(fixture.runtime).openDawproject(new File([archive], 'Notes.dawproject'));
		assert.ok(opened);
		const imported = opened.project;
		assert.ok(validateSoundscaperProject(imported));
		assert.equal(imported.metadata.comments, comment);
	});
}

test('native DAWproject delivery preserves authored comment indentation and final line break', async () => {
	const project = createSoundscaperProject({ id: 'metadata-space', metadata: { comments: COMMENT } });
	const delivered: Blob[] = [];
	const fixture = createFixture({ getProject: () => project,
		fileService: { isDesktop: false, chooseSaveTarget: async () => null,
			prepareSave: async request => ({ mode: 'blob', fileName: request.suggestedName, target: null }),
			saveFile: async request => { assert.ok(request.blob instanceof Blob); delivered.push(request.blob); return { fileName: request.suggestedName }; } },
	});
	fixture.replaceProject(project.id);
	await createNativeProjectService(fixture.runtime).saveDawproject();
	assert.equal(delivered.length, 1);
	const blob = delivered[0]; assert.ok(blob);
	const archive = await readDawprojectArchive(blob);
	try {
		assert.equal(archive.metadataXml.match(/<Comment>([\s\S]*?)<\/Comment>/u)?.[1], COMMENT,
			'the delivered XML must preserve xs:string character data, before reopening');
		assert.equal(parseDawprojectDocument(archive.projectXml, archive.metadataXml).metadata.comment, COMMENT);
	} finally { await archive.close(); }
});
