/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker, downloadBytes, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { routeRippleProject } from '../helpers/next-route-ripple-project.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createImportedSourceProvenance } from '../../src/common/editor/source-provenance.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

async function nativeArchive(project, source) {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `p3-file-${crypto.randomUUID()}` });
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(source.frameCount).fill(.25)]); await writer.commit();
		const { blob } = await exportScapeProject(project, store);
		return { name: 'Project.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) };
	} finally { await store.close(); }
}

test('recording inputs retain a native track identity matching a prototype setter', async ({ page }) => {
	test.setTimeout(90_000);
	await page.addInitScript(() => {
		Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { configurable: true,
			value: async () => [{ kind: 'audioinput', deviceId: 'default', groupId: 'studio', label: 'Studio interface' }] });
		Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true,
			value: async () => { throw new DOMException('Input permission declined.', 'NotAllowedError'); } });
	});
	const source = createAudioSource({ id: 'source', frameCount: 48_000, channelCount: 1, sampleRate: 48_000 });
	const project = createSoundscaperProject({ id: 'p3-recording-route', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 48_000, sourceDurationFrames: 48_000 })],
		tracks: [createAudioTrack({ id: '__proto__', name: 'Voice', clipIds: ['clip'] })] });
	let editor = await openArchive(page, await nativeArchive(project, source), project.id);
	await chooseCommandAction(page, editor, 'View', 'Enable multi-track recording');
	let controls = editor.locator('[data-recording-input-track="__proto__"]');
	await expect(controls).toHaveAttribute('data-recording-input-health', 'unassigned');
	await controls.getByRole('combobox', { name: 'Recording source: Voice', exact: true }).selectOption('device:default');
	await expect.poll(() => page.evaluate(async ({ databaseName, projectId }) => {
		const database = await new Promise((resolve, reject) => {
			const request = indexedDB.open(databaseName); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
		});
		try { return await new Promise((resolve, reject) => {
			const request = database.transaction('settings').objectStore('settings').get(`recording-input-routing-v1:${projectId}`);
			request.onsuccess = () => resolve(Object.hasOwn(request.result?.value?.routes || {}, '__proto__'));
			request.onerror = () => reject(request.error);
		}); } finally { database.close(); }
	}, { databaseName: SOUNDSCAPER_DATABASE_NAME, projectId: project.id })).toBe(true);
	await page.reload(); editor = await waitForEditor(page); await waitForProjectActivation(editor);
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await chooseCommandAction(page, editor, 'View', 'Enable multi-track recording');
	controls = editor.locator('[data-recording-input-track="__proto__"]');
	await expect(controls.getByRole('combobox', { name: 'Recording source: Voice', exact: true })).toHaveValue('device:default');
});

async function openArchive(page, file, projectId) {
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', projectId);
	await waitForProjectActivation(editor);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only');
	return editor;
}

test('shorter Bin replacement keeps authored output automation aligned after Contract gaps', async ({ page }) => {
	const { project: base, source } = routeRippleProject();
	const first = base.clips.find(clip => clip.id === 'first');
	const project = createSoundscaperProject({ ...base, projectBin: { clips: [{ ...first, id: 'bin', binItemId: 'bin-item' }] } });
	const editor = await openArchive(page, await nativeArchive(project, source), project.id);
	const card = editor.locator('[data-project-bin-item="bin-item"]');
	await card.getByRole('button', { name: /More file actions/u }).click();
	const choosing = page.waitForEvent('filechooser');
	await page.getByRole('menuitem', { name: 'Replace', exact: true }).click();
	await (await choosing).setFiles(createWavFixture({ name: 'Short.wav', duration: .5, sampleRate: 48_000 }));
	const choice = page.locator('[data-project-bin-replacement-dialog]');
	await expect(choice).toBeVisible();
	await choice.getByRole('button', { name: 'Contract gaps', exact: true }).click();
	await expect(choice).toBeHidden();
	const laterPoint = async () => (await persistedProject(page, project.id))?.automationLanes
		.find(lane => lane.id === 'voice-output')?.points.find(point => point.id === 'voice-later')?.position;
	await expect.poll(laterPoint).toBe(168_000);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(laterPoint).toBe(192_000);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(laterPoint).toBe(168_000);
});

for (const credit of ['Third credit', { credit: 'Nested credit' }]) {
	test(`Attribution retains a custom metadata key matching a prototype setter (${typeof credit})`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const tags = Object.fromEntries([['__proto__', credit], ['constructor', 'First credit'], ['toString', 'Second credit']]);
		const provenance = createImportedSourceProvenance({ id: 'credit', origin: {
			kind: 'local-file', originalFileName: 'Credits.mp3', mimeType: 'audio/mpeg',
		}, metadata: { raw: { TXXX: tags } } });
		const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1, provenance });
		const clip = createAudioClip({ id: 'clip', title: 'Credit recording', sourceId: source.id, durationFrames: 48_000, sourceDurationFrames: 48_000 });
		const project = createSoundscaperProject({ id: `p3-credit-${typeof credit}`, sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
		const editor = await openArchive(page, await nativeArchive(project, source), project.id);
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		const metadata = editor.locator('[data-workspace-panel="metadata"]');
		await metadata.getByRole('tab', { name: 'Attribution', exact: true }).click();
		const attribution = metadata.getByRole('tabpanel', { name: 'Attribution', exact: true });
		await attribution.getByText('Imported metadata', { exact: true }).click();
		const label = typeof credit === 'string' ? 'raw.TXXX.__proto__' : 'raw.TXXX.__proto__.credit';
		const value = typeof credit === 'string' ? credit : credit.credit;
		await expect(attribution.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) })).toContainText(value);
		const downloading = page.waitForEvent('download');
		await attribution.getByRole('button', { name: 'Export CSV', exact: true }).click();
		expect(new TextDecoder().decode(await downloadBytes(await downloading))).toContain(value);
	});
}
