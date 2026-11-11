import initSqlJs from 'sql.js';
import { createAup3Fixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, trackNameText, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createAup3ProjectData, serializeAup3Xml } from '../aup3-fixture.js';
import { FORMAT_FILE_FAILURE_COPY } from '../../src/common/i18n/editor-format-file-failure-copy.ts';
import { OPERATION_STATUS_COPY_BY_LOCALE } from '../../src/common/i18n/operation-status-copy.js';

import { persistedProject } from './helpers/complex-editing-workflows.js';

test('opens shared and checkpointed AUP3 audio, reloads native storage, and recovers from a readable refusal', async ({ page }) => {
	const caseTimeout = test.info().timeout;
	test.setTimeout(caseTimeout * 3);
	// The source-count oracle inspects the whole browser database, so run the
	// shared recording first while storage is pristine; New retains prior media.
	const editor = await test.step('shared blocks keep one physical backing source across reload', async () => {
		await page.addInitScript(() => {
			const NativeWorker = globalThis.Worker;
			globalThis.__audacityImportRequests = [];
			globalThis.Worker = class extends NativeWorker {
				constructor(url, options) { super(url, options); this.audacity = options?.name === 'kw-media-audacity-projects'; }
				postMessage(message, ...options) {
					if (this.audacity) globalThis.__audacityImportRequests.push(message.type);
					super.postMessage(message, ...options);
				}
			};
		});
		const options = { tracks: [{ name: 'Shared recording', clips: [{
			samples: Array.from({ length: 65_536 }, (_, index) => Math.sin(index / 17) * 0.5),
			trimLeft: 0.1, trimRight: 0.1,
		}] }] };
		const SQL = await initSqlJs();
		const database = new SQL.Database(await createAup3Fixture({ SQL, ...options }));
		let bytes;
		try {
			const root = createAup3ProjectData(options).project;
			const track = root.children[0], clip = track.children[0];
			for (let index = 1; index < 10; index += 1) {
				const duplicate = structuredClone(clip);
				duplicate.attributes.offset = index * 2;
				track.children.push(duplicate);
			}
			const { dictionary, document } = serializeAup3Xml(root);
			database.run('UPDATE project SET dict = ?, doc = ? WHERE id = 1', [dictionary, document]);
			bytes = database.export();
		} finally { database.close(); }
		let editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		const chooser = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await chooser).setFiles({ name: 'shared.aup3', mimeType: 'application/x-audacity-project', buffer: Buffer.from(bytes) });
		await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
		await expect(editor).toHaveAttribute('data-clip-count', '10');
		const storage = await page.evaluate(async () => {
			const request = (input) => new Promise((resolve, reject) => {
				input.onsuccess = () => resolve(input.result);
				input.onerror = () => reject(input.error);
			});
			const database = await request(indexedDB.open('kw-media-soundscaper-editor-v1'));
			try {
				const sources = await request(database.transaction('sources', 'readonly').objectStore('sources').getAll());
				const sequences = sources.filter((source) => source.storage === 'sample-block-sequence');
				const pools = sources.filter((source) => sequences.some((sequence) => sequence.baseSourceId === source.id));
				return { sequences: sequences.length, pools: pools.length, frames: pools[0]?.frameCount };
			} finally { database.close(); }
		});
		expect(storage).toEqual({ sequences: 1, pools: 1, frames: 65_536 });
		await page.reload();
		editor = page.locator('[data-audio-editor]');
		await expect(editor).toHaveAttribute('data-clip-count', '10', { timeout: 30_000 });
		await expect(trackNameText(editor).first()).toHaveText('Shared recording');
		return editor;
	}, { timeout: caseTimeout });
	await test.step('a fresh checkpointed project pulls exactly six native worker chunks', async () => {
		const previousProjectId = await editor.getAttribute('data-project-id');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await expect(editor).not.toHaveAttribute('data-project-id', previousProjectId);
		await waitForProjectActivation(editor);
		await expect(editor).toHaveAttribute('data-editor-ready', 'true');
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		const projectId = await editor.getAttribute('data-project-id');
		await expect.poll(async () => (await persistedProject(page, projectId))?.sources.length).toBe(0);
		// Prior imports and the real reload have completed. Fence only the probe;
		// the production worker and its source storage remain intact.
		await page.evaluate(() => { globalThis.__audacityImportRequests.length = 0; });
		const samples = Array.from({ length: 65_536 }, (_, index) => Math.sin(index / 17) * 0.5);
		const blocks = [{ samples }, { samples }, { samples: [0.25] }];
		const bytes = await createAup3Fixture({ tracks: [
			{ name: 'Stereo recording', channel: 0, linked: true, clips: [{ blocks }] },
			{ name: 'Stereo recording', channel: 1, clips: [{ blocks }] },
		] });
		// Native 3.7 projects keep WAL flags even in their checkpointed main file.
		bytes[18] = 2;
		bytes[19] = 2;
		new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(60, 0x03070000);
		const chooser = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await chooser).setFiles({
			name: 'Windows recording.AUP3', mimeType: 'application/x-audacity-project', buffer: Buffer.from(bytes),
		});
		await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
		await expect(editor).toHaveAttribute('data-track-count', '1');
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(trackNameText(editor).first()).toHaveText('Stereo recording');
		const requests = await page.evaluate(() => globalThis.__audacityImportRequests);
		expect(requests).toContain('plan-import');
		expect(requests).toContain('read-import-chunk');
		expect(requests.filter((type) => type === 'read-import-chunk')).toHaveLength(6);
		expect(requests).not.toContain('decode');
	}, { timeout: caseTimeout });
	await test.step('a fresh project retains readable refusal, focus, and valid File Open retry', async () => {
		const previousProjectId = await editor.getAttribute('data-project-id');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await expect(editor).not.toHaveAttribute('data-project-id', previousProjectId);
		await waitForProjectActivation(editor);
		await expect(editor).toHaveAttribute('data-editor-ready', 'true');
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		const projectId = await editor.getAttribute('data-project-id');
		await expect.poll(async () => (await persistedProject(page, projectId))?.sources.length).toBe(0);
		const SQL = await initSqlJs();
		const bytes = await createAup3Fixture({ SQL });
		const database = new SQL.Database(bytes);
		const table = `unsupported_${'project_metadata_'.repeat(12)}end`;
		let invalid;
		try {
			database.run(`CREATE TABLE ${table} (id INTEGER)`);
			invalid = database.export();
		} finally { database.close(); }
		const originalProject = await editor.getAttribute('data-project-id');
		await editor.locator('[data-aup4-input]').setInputFiles({
			name: 'unsupported.aup3', mimeType: 'application/x-audacity-project', buffer: Buffer.from(invalid),
		});
		const errorToast = editor.locator('[data-editor-toast="workspace-error"]');
		await expect(errorToast).toBeVisible({ timeout: 30_000 });
		await expect(errorToast.locator('.toast')).toHaveClass(/toast--error/);
		const description = errorToast.locator('.toast__description');
		const publicError = OPERATION_STATUS_COPY_BY_LOCALE.en.genericError.replace('{message}', FORMAT_FILE_FAILURE_COPY.audacityUnsupported);
		await expect(description).toHaveText(publicError);
		await expect(editor).toHaveAttribute('data-project-id', originalProject);
		await expect(description).toHaveCSS('overflow-wrap', 'anywhere');
		expect(await description.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
		const dismiss = errorToast.locator('.kw-audio-editor__toast-close');
		await dismiss.focus();
		await expect(dismiss).toBeFocused();
		await editor.locator('[data-aup4-input]').setInputFiles({
			name: 'valid.aup3', mimeType: 'application/x-audacity-project', buffer: Buffer.from(bytes),
		});
		await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
		await expect(errorToast).toHaveCount(0);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
	}, { timeout: caseTimeout });
});
