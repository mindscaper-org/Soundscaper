/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createNativeProjectService } from '../../src/common/editor/controller/document/native-project-service.ts';
import { readDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { parseDawprojectDocument } from '../../src/common/editor/dawproject-import.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { importSoundscaperAudacityProject } from '../../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject, type SoundscaperProject } from '../../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { createFixture } from './native-project-service-fixture.ts';
import { readPcm } from './project-store-pcm-fixture.ts';

/** Real format services and stores; only the browser's save picker is replaced. */
export async function dawprojectArchiveCustody(
	project: SoundscaperProject,
	channels: ReadonlyMap<string, readonly Float32Array[]>,
) {
	const stores = Array.from({ length: 3 }, () => createProjectStore({
		indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID(),
	}));
	const [original, imported, reopenedStore] = stores;
	assert.ok(original && imported && reopenedStore);
	try {
		for (const source of project.sources) {
			if (source.kind !== 'audio') continue;
			const pcm = channels.get(source.storageKey);
			assert.ok(pcm, `Missing independent source PCM for ${source.name}`);
			const writer = await original.beginSourceWrite(source.storageKey, source);
			await writer.write(pcm);
			await writer.commit();
		}
		const saved: Blob[] = [];
		const exporting = createFixture({ getProject: () => project, store: original,
			fileService: { isDesktop: false, chooseSaveTarget: async () => null,
				prepareSave: async request => ({ mode: 'blob', fileName: request.suggestedName, target: null }),
				saveFile: async request => {
					assert.ok(request.blob instanceof Blob);
					saved.push(request.blob);
					return { fileName: request.suggestedName };
				} },
		});
		exporting.replaceProject(project.id);
		const before = structuredClone(project);
		await createNativeProjectService(exporting.runtime).saveDawproject();
		assert.deepEqual(project, before, 'export cannot rewrite the editable document');
		assert.equal(saved.length, 1);
		const blob = saved[0]; assert.ok(blob);
		const archive = await readDawprojectArchive(blob);
		let document;
		try { document = parseDawprojectDocument(archive.projectXml, archive.metadataXml); }
		finally { await archive.close(); }
		let minted = 0;
		const importing = createFixture({ store: imported, adaptAudacityProject: importSoundscaperAudacityProject,
			createStableId: prefix => `${prefix}-${String(++minted)}` });
		const opened = await createNativeProjectService(importing.runtime).openDawproject(new File([blob], 'Roundtrip.dawproject'));
		assert.ok(opened && validateSoundscaperProject(opened.project));
		const native = createSoundscaperScapeNativeRuntime();
		const portable = await native.exportScapeProject(opened.project, imported);
		assert.ok(portable.blob);
		const reopened = await native.importScapeProject(portable.blob, reopenedStore);
		const documentProject: unknown = reopened.project;
		assert.ok(validateSoundscaperProject(documentProject));
		const pcm = new Map<string, number[][]>();
		for (const source of documentProject.sources) {
			if (source.kind === 'audio') pcm.set(source.name, await readPcm(reopenedStore, source.storageKey));
		}
		return { document, project: documentProject, pcm, report: opened.report };
	} finally {
		for (const store of stores) await store.close();
	}
}
