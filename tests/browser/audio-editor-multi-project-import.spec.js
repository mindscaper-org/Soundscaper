/* SPDX-License-Identifier: AGPL-3.0-only */

import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, clipByName, fileDataTransfer, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';

async function archiveFile(id, title) {
	const exported = await createSoundscaperScapeNativeRuntime().exportScapeProject(createSoundscaperProject({ id, title }), {
		async getMediaAssetMetadata() { return null; }, async loadMediaAsset() { return null; },
		async *readSourceChunks() {},
	});
	return { name: `${id}.sscape`, mimeType: 'application/zip', buffer: Buffer.from(await exported.blob.arrayBuffer()) };
}

test('the Import picker opens healthy projects on both sides of a damaged archive', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const first = await archiveFile('batch-first', 'First batch edit');
	const last = await archiveFile('batch-last', 'Last batch edit');
	await importFiles(editor, [first,
		{ name: 'broken.sscape', mimeType: 'application/zip', buffer: Buffer.from('This is not a Scape archive.') },
		last]);
	await expect(editor.getByRole('tab', { name: 'First batch edit', exact: true })).toBeVisible();
	await expect(editor.getByRole('tab', { name: 'Last batch edit', exact: true })).toHaveAttribute('aria-selected', 'true');
	await waitForProjectActivation(editor);
	await expect(editor).toHaveAttribute('data-project-id', 'batch-last');
});

test('dropping a Scape file and a recording opens the archive before placing the recording', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const outgoing = await editor.getAttribute('data-project-id');
	const incoming = await archiveFile('drop-incoming', 'Dropped edit');
	const target = editor.locator('[data-timeline]');
	const box = await target.boundingBox();
	expect(box).not.toBeNull();
	const transfer = await fileDataTransfer(page, [incoming, toneA]);
	await target.dispatchEvent('drop', { dataTransfer: transfer, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
	await transfer.dispose();
	await expect(editor.getByRole('tab', { name: 'Dropped edit', exact: true })).toHaveAttribute('aria-selected', 'true');
	await waitForProjectActivation(editor);
	await expect(clipByName(editor, toneA.name)).toHaveCount(1);
	await expect(editor).toHaveAttribute('data-project-id', 'drop-incoming');
	await editor.getByRole('tab', { name: 'Untitled project', exact: true }).click();
	await waitForProjectActivation(editor);
	await expect(editor).toHaveAttribute('data-project-id', outgoing);
	await expect(clipByName(editor, toneA.name)).toHaveCount(0);
});

test('the Project Bin opens a dropped project and files the accompanying recording in that bin', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: true });
	const original = await editor.getAttribute('data-project-id');
	const next = await archiveFile('bin-dropped-project', 'New bin project');
	const bin = editor.locator('[data-project-bin-drop-target]');
	const files = await fileDataTransfer(page, [next, toneA]);
	await bin.dispatchEvent('drop', { dataTransfer: files });
	await files.dispose();
	await expect(editor).toHaveAttribute('data-project-id', 'bin-dropped-project');
	await waitForProjectActivation(editor);
	const card = editor.getByRole('listitem', { name: `Project bin: ${toneA.name.replace(/\.wav$/u, '')}`, exact: true });
	await expect(card).toHaveCount(1);
	await expect(clipByName(editor, toneA.name)).toHaveCount(0);
	await editor.getByRole('tab', { name: 'Untitled project', exact: true }).click();
	await waitForProjectActivation(editor);
	await expect(editor).toHaveAttribute('data-project-id', original);
	await expect(card).toHaveCount(0);
});

test('File Open can leave a read-only version of another window’s project', async ({ page, context }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const original = await editor.getAttribute('data-project-id');
	const other = await context.newPage();
	try {
		const otherEditor = await bootEditor(other, '/embed/en/');
		await expect(otherEditor).toHaveAttribute('data-project-id', original);
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		const next = await archiveFile('leaving-read-only', 'Newly opened edit');
		await page.bringToFront();
		await editor.locator('[data-aup4-input]').setInputFiles(next);
		await expect(editor.getByRole('tab', { name: 'Newly opened edit', exact: true })).toHaveAttribute('aria-selected', 'true');
		await waitForProjectActivation(editor);
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only');
		await expect(otherEditor).toHaveAttribute('data-project-id', original);
	} finally { await other.close(); }
});

test('the browser picker opens the archive even when an optional write grant is unavailable', async ({ page }) => {
	const archive = await archiveFile('no-write-grant', 'Readable project');
	await installBrowserFilePicker(page, archive, true);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseFileAction(page, editor, 'Open');
	await expect(editor.getByRole('tab', { name: 'Readable project', exact: true })).toHaveAttribute('aria-selected', 'true');
	expect(await page.evaluate(() => globalThis.browserFileWriteRequests)).toBe(1);
});

test('File Open places a recording in a new project without asking to overwrite it', async ({ page }) => {
	const recording = { ...toneA, name: 'Read-only recording.wav' };
	await installBrowserFilePicker(page, recording, false);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseFileAction(page, editor, 'Open');
	await expect(editor.getByRole('tab', { name: 'Read-only recording', exact: true })).toHaveAttribute('aria-selected', 'true');
	await expect(clipByName(editor, recording.name)).toBeVisible();
	expect(await page.evaluate(() => globalThis.browserFileWriteRequests)).toBe(0);
});

test('cancelling a project conflict ends that OS launch batch', async ({ page }) => {
	await installLaunchQueue(page);
	const editor = await bootEditor(page, '/embed/en/');
	const first = await archiveFile('batch-conflict', 'Local edit');
	await importFiles(editor, [first]);
	await expect(editor).toHaveAttribute('data-project-id', 'batch-conflict');
	await waitForProjectActivation(editor);
	const conflict = await archiveFile('batch-conflict', 'Conflicting edit');
	const later = await archiveFile('batch-cancel-later', 'Unopened batch edit');
	const nextLaunch = await archiveFile('batch-next-launch', 'Next launch edit');
	await launchBatches(page, [[conflict, later], [nextLaunch]]);
	const dialog = page.locator('[data-scape-open-decision="collision"]');
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(editor.getByRole('tab', { name: 'Next launch edit', exact: true })).toHaveAttribute('aria-selected', 'true');
	await expect(editor.getByRole('tab', { name: 'Local edit', exact: true })).toBeVisible();
	await expect(editor.getByRole('tab', { name: 'Unopened batch edit', exact: true })).toHaveCount(0);
});

test('cancelling a CUE destination skips the following sheet and releases the launch queue', async ({ page }) => {
	await installLaunchQueue(page);
	const editor = await bootEditor(page, '/embed/en/');
	const project = await archiveFile('cue-sheet-project', 'Edit with CUE sheets');
	const nextLaunch = await archiveFile('after-cue-cancel', 'Launched after CUE');
	const cueFiles = ['first.cue', 'second.cue'].map(name => ({ name, mimeType: 'application/x-cue',
		buffer: Buffer.from('FILE "take.wav" WAVE\n TRACK 01 AUDIO\n INDEX 01 00:00:00\n') }));
	await launchBatches(page, [[project, ...cueFiles], [nextLaunch]]);
	const destination = page.getByRole('dialog', { name: 'Import', exact: true });
	await expect(destination).toContainText('first.cue');
	await destination.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(editor.getByRole('tab', { name: 'Launched after CUE', exact: true })).toHaveAttribute('aria-selected', 'true');
	await expect(destination).toHaveCount(0);
});

test('a mixed import retires its CUE chooser when a desktop launch reopens the outgoing tab', async ({ page }) => {
	const original = await archiveFile('cue-origin-project', 'Original tab before CUE');
	await installDesktopArchiveLaunch(page, original);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [original]);
	await expect(editor).toHaveAttribute('data-project-id', 'cue-origin-project');
	await waitForProjectActivation(editor);
	const project = await archiveFile('cue-target-project', 'Project for new CUE');
	await editor.locator('[data-import-input]').setInputFiles([project, { name: 'target.cue', mimeType: 'application/x-cue',
		buffer: Buffer.from('TRACK 01 AUDIO\n TITLE "Target cue"\n INDEX 01 00:00:00\n') }]);
	const chooser = page.locator('[data-cue-import-choice]');
	await expect(chooser).toBeVisible();
	await expect(editor).toHaveAttribute('data-project-id', 'cue-target-project');
	await page.evaluate(() => globalThis.launchNativeArchive());
	await expect(editor).toHaveAttribute('data-project-id', 'cue-origin-project');
	await waitForProjectActivation(editor);
	await expect(chooser).toHaveCount(0);
	await expect(editor.locator('[data-label-id]')).toHaveCount(0);
});

test('an OS project launch waits for a manual audio import to finish', async ({ page }) => {
	await installLaunchQueue(page);
	await holdManualRecording(page);
	const editor = await bootEditor(page, '/embed/en/');
	const origin = await editor.getAttribute('data-project-id');
	const audio = { ...toneA, name: 'Held manual recording.wav' };
	await editor.locator('[data-import-input]').setInputFiles(audio);
	await expect.poll(() => page.evaluate(() => globalThis.manualMediaPending)).toBe(true);
	const incoming = await archiveFile('launch-during-import', 'Waiting file launch');
	await launchBatches(page, [[incoming]]);
	await expect(editor).toHaveAttribute('data-project-id', origin);
	await page.evaluate(() => globalThis.releaseManualMedia());
	await expect(editor.getByRole('tab', { name: 'Waiting file launch', exact: true })).toHaveAttribute('aria-selected', 'true');
	await waitForProjectActivation(editor);
	await editor.getByRole('tab', { name: 'Untitled project', exact: true }).click();
	await waitForProjectActivation(editor);
	await expect(clipByName(editor, audio.name)).toBeVisible();
});

test('a desktop file association waits until an ongoing recording import has published', async ({ page }) => {
	const incoming = await archiveFile('desktop-launch-during-import', 'Waiting desktop file');
	await installDesktopArchiveLaunch(page, incoming);
	await holdManualRecording(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-import-input]').setInputFiles({ ...toneA, name: 'Held manual recording.wav' });
	await expect.poll(() => page.evaluate(() => globalThis.manualMediaPending)).toBe(true);
	await page.evaluate(async () => {
		globalThis.launchNativeArchive();
		await new Promise(resolve => { requestAnimationFrame(() => { requestAnimationFrame(resolve); }); });
	});
	expect(await page.evaluate(() => globalThis.nativeArchiveReleased)).toBe(false);
	await page.evaluate(() => globalThis.releaseManualMedia());
	await expect(editor.getByRole('tab', { name: 'Waiting desktop file', exact: true })).toHaveAttribute('aria-selected', 'true');
	await expect.poll(() => page.evaluate(() => globalThis.nativeArchiveReleased)).toBe(true);
});

async function holdManualRecording(page) {
	await page.addInitScript(() => {
		const held = new WeakSet();
		const slice = File.prototype.slice;
		File.prototype.slice = function (...args) {
			const blob = slice.apply(this, args);
			if (this.name === 'Held manual recording.wav') held.add(blob);
			return blob;
		};
		const read = Blob.prototype.arrayBuffer;
		const released = new Promise(resolve => { globalThis.releaseManualMedia = resolve; });
		Blob.prototype.arrayBuffer = async function () {
			if (held.has(this)) {
				globalThis.manualMediaPending = true;
				await released;
			}
			return read.call(this);
		};
	});
}

async function installDesktopArchiveLaunch(page, archive) {
	await page.addInitScript(({ base64, name }) => {
		const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
		const id = 'd'.repeat(40);
		const descriptor = { id, name, mimeType: 'application/vnd.soundscaper.scape+zip', readProfile: 'scape-range-v1',
			size: bytes.length, url: `soundscaper-app://bundle/_desktop/read/scape-range-v1/${id}/${name}` };
		const fetch = globalThis.fetch;
		globalThis.fetch = (input, init) => {
			if (String(input) !== descriptor.url) return fetch(input, init);
			const [, start, end] = /^bytes=(\d+)-(\d+)$/u.exec(new Headers(init.headers).get('Range'));
			const body = bytes.slice(Number(start), Number(end) + 1);
			return Promise.resolve(new Response(body, { status: 206, headers: {
				'Content-Type': descriptor.mimeType, 'Content-Length': String(body.length),
				'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
			} }));
		};
		globalThis.nativeArchiveReleased = false;
		globalThis.soundscaperDesktop = { v1: {
			onOpenProject(listener) { globalThis.launchNativeArchive = () => listener(descriptor); return () => {}; },
			async releaseRead(readId) { if (readId === id) globalThis.nativeArchiveReleased = true; },
		} };
	}, { base64: archive.buffer.toString('base64'), name: archive.name });
}

async function installLaunchQueue(page) {
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, 'launchQueue', { configurable: true,
			value: { setConsumer(consumer) { globalThis.acceptTestLaunch = consumer; } } });
	});
}

async function installBrowserFilePicker(page, file, refuseWrite) {
	await page.addInitScript(({ base64, name, mimeType, refuseWrite }) => {
		globalThis.browserFileWriteRequests = 0;
		const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
		Object.defineProperty(globalThis, 'showOpenFilePicker', { configurable: true, value: async () => [{
			getFile: async () => new File([bytes], name, { type: mimeType }),
			createWritable() { throw new Error('These tests do not save over the selected file.'); },
			async requestPermission() {
				globalThis.browserFileWriteRequests += 1;
				if (refuseWrite) throw new DOMException('Write access is unavailable.', 'NotAllowedError');
				return 'granted';
			},
		}] });
	}, { base64: file.buffer.toString('base64'), name: file.name, mimeType: file.mimeType, refuseWrite });
}

async function launchBatches(page, batches) {
	await page.evaluate(input => {
		for (const batch of input) {
			globalThis.acceptTestLaunch({ files: batch.map(({ name, mimeType, bytes }) => ({
				kind: 'file', getFile: () => Promise.resolve(new File([Uint8Array.from(bytes)], name, { type: mimeType })),
			})) });
		}
	}, batches.map(batch => batch.map(({ name, mimeType, buffer }) => ({ name, mimeType, bytes: [...buffer] }))));
}
