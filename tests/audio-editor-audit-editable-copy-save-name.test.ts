/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createCrossProductHandoffLaunchIntent } from '../src/common/cross-product-handoff-intent.ts';
import { createCrossProductHandoffActionFacade } from '../src/common/editor/controller/document/cross-product-handoff-action-facade.ts';
import { SaveTargetStore, AtomicSaveManager } from '../desktop/save-targets.js';
import { boundCrossProductHandoffArchiveFileName, admitCrossProductHandoffReportSidecar,
	crossProductHandoffReportSidecarFileName } from '../src/common/transfer/cross-product-handoff-report-sidecar.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { saveHandoffArtifact } from '../src/common/editor/controller/document/internal/cross-product-handoff-save-target.ts';

for (const name of ['Song: mix.fscape', `${'x'.repeat(240)}.fscape`]) {
	test(`editable-copy Save As reconfirms an archive/report pair before writing a ${name.includes(':') ? 'colon' : 'long'} name`, async () => {
		const root = await mkdtemp(join(tmpdir(), 'scape-copy-name-'));
		const source = createSoundscaperProject({ id: 'name-source', title: 'Editable copy' });
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'copy-name' });
		const restoredStore = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'copy-name-restore' });
		const owner = {}, targets = new SaveTargetStore();
		const saveOptions = { targets, maximumSessions: 2 }, saves = new AtomicSaveManager(saveOptions);
		const choices: string[] = [], released: string[] = [], writes: number[] = [];
		const bridge = {
			chooseSaveTarget(request: { purpose: string; suggestedName: string }) {
				const chosen = choices.length === 0 ? name : request.suggestedName;
				choices.push(chosen); return targets.registerPath(join(root, chosen), { owner, purpose: request.purpose });
			},
			releaseSaveTarget(id: string) { released.push(id); return targets.release(id, { owner }); },
			beginWrite(request: { targetId: string; size: number }) { writes.push(choices.length); return saves.begin({ ...request, owner }); },
			writeChunk(request: { writeId: string; offset: number; data: Uint8Array }) { return saves.writeChunk({ ...request, owner }); },
			finishWrite(id: string) { return saves.finish(id, { owner }); },
			abortWrite(id: string) { return saves.abort(id, { owner }); },
		};
		try {
			const fileService = createAudioEditorFileService({ scope: { URL }, bridge, document: null });
			const facade = createCrossProductHandoffActionFacade({ getProject: () => source,
				assertProjectHandoffAllowed() {}, flushProject() {}, store, fileService, copy: { projectSaving: 'Saving project' } });
			const intent = createCrossProductHandoffLaunchIntent({ sourceProject: source, destinationFamily: 'framescaper',
				invocationId: 'name-check', destinationProjectId: 'name-destination' });
			const result = await facade.saveCrossProductCopy(intent) as { fileName: string; reportFileName: string };
			const expected = boundCrossProductHandoffArchiveFileName(name);
			assert.equal(result.fileName, expected);
			assert.equal(result.reportFileName, crossProductHandoffReportSidecarFileName(expected));
			assert.deepEqual((await readdir(root)).sort(), [expected, result.reportFileName].sort());
			assert.deepEqual(writes, [2, 3], 'no archive write may start until the paired name is reconfirmed');
			assert.ok(released.length >= 1, 'abandoned native save capabilities are released');
			const archive = new Uint8Array(await readFile(join(root, expected)));
			const restored = await createFramescaperScapeNativeRuntime(FRAMESCAPER_PROJECT_RUNTIME_PROFILE)
				.importScapeProject(new File([archive], expected), restoredStore);
			assert.equal(restored.readOnly, false);
			assert.equal(restored.project.schemaFamily, 'framescaper');
			const report: unknown = JSON.parse(await readFile(join(root, result.reportFileName), 'utf8'));
			assert.equal(admitCrossProductHandoffReportSidecar(report, { entryId: intent.destination.projectId, archive }).entryId, intent.destination.projectId);
			assert.equal(facade.crossProductCopyActive(), false);
		} finally {
			await saves.dispose(); targets.dispose(); await store.close(); await restoredStore.close();
			await rm(root, { recursive: true, force: true });
		}
	});
}

test('cancelling a reconfirmed paired filename releases the rejected target without writing bytes', async () => {
	const rejected = { id: 'rejected-target', name: 'Song: mix.fscape' }, released: unknown[] = [];
	let choices = 0;
	const result = await saveHandoffArtifact({
		chooseSaveTarget: () => { if (choices++ === 0) return rejected; throw new DOMException('Cancelled', 'AbortError'); },
		releaseSaveTarget: target => { released.push(target); },
		saveFile(request) { assert.equal(request.target, null); return { cancelled: true }; },
	}, { purpose: 'project-copy', blob: new Blob(['archive']), suggestedName: 'Session.fscape',
		mimeType: 'application/octet-stream', signal: new AbortController().signal, useFileSystemAccess: false });
	assert.deepEqual(result, { cancelled: true });
	assert.deepEqual(released, [rejected]);
	assert.equal(choices, 2);
});
