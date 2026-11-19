/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createNativeProjectService } from '../../src/common/editor/controller/document/native-project-service.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { importSoundscaperAudacityProject } from '../../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../../src/soundscaper/editor-project-validation.ts';
import { createFixture } from './native-project-service-fixture.ts';
import { readPcm } from './project-store-pcm-fixture.ts';
import { dawprojectArchiveCustody, readDawprojectImportReport } from './dawproject-archive-custody.ts';

/** Foreign File Open, real memory-backed store, DAW delivery and independent Scape recipient. */
export async function importedDawprojectArchiveCustody(blob: Blob) {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		let ordinal = 0;
		const fixture = createFixture({ store, adaptAudacityProject: importSoundscaperAudacityProject,
			createStableId: prefix => `${prefix}-${String(++ordinal)}` });
		const opened = await createNativeProjectService(fixture.runtime).openDawproject(new File([blob], 'Foreign.dawproject'));
		assert.ok(opened && validateSoundscaperProject(opened.project));
		const importReport = readDawprojectImportReport(opened.report);
		const channels = new Map<string, readonly Float32Array[]>();
		for (const source of opened.project.sources) {
			if (source.kind === 'audio') channels.set(source.storageKey,
				(await readPcm(store, source.storageKey)).map(channel => Float32Array.from(channel)));
		}
		const reopened = await dawprojectArchiveCustody(opened.project, channels);
		return { initial: opened.project, importReport, ...reopened };
	} finally { await store.close(); }
}
