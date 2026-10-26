/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const damaged of [false, true]) test(`Recover checks a supported high-rate physical source clock damaged=${String(damaged)}`, async ({ page }) => {
	test.setTimeout(90_000);
	const sources = [createAudioSource({ id: 'clock', sampleRate: 768_000, frameCount: 7680, channelCount: 1 }),
		createAudioSource({ id: 'peer', sampleRate: 48_000, frameCount: 4800, channelCount: 1 })];
	const project = createSoundscaperProject({ id: 'clock-recovery', title: 'Clock recovery', sampleRate: 48_000, sources,
		clips: sources.map((source, index) => createAudioClip({ id: source.id, sourceId: source.id,
			durationFrames: index === 0 ? 480 : 4800, sourceDurationFrames: source.frameCount })),
		tracks: sources.map(source => createAudioTrack({ id: source.id, clipIds: [source.id] })) });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let file;
	try {
		for (const [index, source] of sources.entries()) {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			await writer.write([new Float32Array(source.frameCount).fill(index === 0 ? .25 : .125)]); await writer.commit();
		}
		const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Clock.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file); await expect(editor).toHaveAttribute('data-project-id', project.id);
	await waitForProjectActivation(editor); await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await chooseCommandAction(page, editor, 'File', 'New'); await expect(editor).not.toHaveAttribute('data-project-id', project.id);
	await waitForProjectActivation(editor);
	const original = await page.evaluate(async ({ databaseName, projectId, damaged }) => {
		const database = await new Promise((resolve, reject) => {
			const request = indexedDB.open(databaseName); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
		});
		try {
			return await new Promise((resolve, reject) => {
				const transaction = database.transaction('projects', 'readwrite'); const projects = transaction.objectStore('projects');
				const request = projects.get(projectId); let stored;
				request.onsuccess = () => {
					stored = request.result; if (damaged) stored.sources.find(source => source.id === 'clock').sampleRate = 384_000;
					stored.revision += 100; projects.put(stored);
				};
				transaction.oncomplete = () => resolve(stored); transaction.onabort = () => reject(transaction.error);
			});
		} finally { database.close(); }
	}, { databaseName: SOUNDSCAPER_DATABASE_NAME, projectId: project.id, damaged });
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Recover a project']);
	const dialog = page.getByRole('dialog', { name: 'Project recovery', exact: true }); await expect(dialog).toBeVisible();
	await dialog.getByLabel('Project to recover').selectOption(project.id);
	await expect(dialog.getByLabel('Saved version').locator('option').first()).toContainText(damaged ? 'Needs repair' : 'Ready to recover');
	await dialog.getByRole('button', { name: 'Recover as a new project' }).click(); await expect(dialog).toBeHidden();
	await expect(editor).toHaveAttribute('data-clip-count', damaged ? '1' : '2'); await waitForProjectActivation(editor);
	const recovered = await persistedProject(page, await editor.getAttribute('data-project-id'));
	expect(recovered.sources.map(source => [source.id, source.sampleRate])).toEqual(damaged ? [['peer', 48_000]] : [['clock', 768_000], ['peer', 48_000]]);
	const samples = await exportSamples(page, editor); expect(samples).toHaveLength(4800); expect(samples.every(Number.isFinite)).toBe(true);
	if (damaged) expect(Math.max(...samples.map(sample => Math.abs(sample - .125 * Math.SQRT1_2)))).toBeLessThan(.000001);
	else expect(Math.max(...samples)).toBeGreaterThan(.2);
	expect(await persistedProject(page, project.id)).toEqual(original);
});
