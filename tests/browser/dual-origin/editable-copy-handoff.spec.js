/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createSoundscaperProject } from '../../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../../src/soundscaper/editor-scape-native.ts';

import {
	expect,
	longTone,
	test,
	toneA,
	toneB,
} from '../audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseFileAction,
	chooseNestedCommandAction,
	clipByName,
	closeWorkspacePanel,
	importFiles,
	waitForProjectActivation,
} from '../audio-editor-test-helpers.js';
import {
	FRAMESCAPER_DATABASE_NAME,
	SOUNDSCAPER_DATABASE_NAME,
} from '../helpers/editor-databases.js';
import { resolveBrowserProductTestUrl } from '../helpers/browser-product-test-url.js';

const SOUNDSCAPER_ORIGIN = new URL(resolveBrowserProductTestUrl('/')).origin;
const FRAMESCAPER_ORIGIN = new URL(resolveBrowserProductTestUrl('/framescaper/')).origin;

test('the receiver imports the next selected archive after a local file becomes unreadable', async ({ page }) => {
	await page.addInitScript(() => {
		const read = File.prototype.arrayBuffer;
		File.prototype.arrayBuffer = function () {
			return this.name === 'Offline recording.sscape'
				? Promise.reject(new DOMException('The file is offline.', 'NotReadableError'))
				: read.call(this);
		};
	});
	const archive = await createSoundscaperScapeNativeRuntime().exportScapeProject(
		createSoundscaperProject({ id: 'healthy-manual-transfer', title: 'Healthy manual transfer' }),
		{ async loadMediaAsset() { return null; }, async *readSourceChunks() {} },
	);
	await page.goto(`${SOUNDSCAPER_ORIGIN}/transfer/receive/`);
	await page.getByLabel('Import downloaded project archives and conversion-report sidecars').setInputFiles([
		{ name: 'Offline recording.sscape', mimeType: 'application/zip', buffer: Buffer.from('missing') },
		{ name: 'Healthy manual transfer.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) },
	]);
	await expect(page.locator('li[data-outcome="failed"]')).toContainText('The file is offline.');
	await expect(page.locator('li[data-outcome="stored"]')).toContainText('Healthy manual transfer');
	expect(await persistedProject(page, SOUNDSCAPER_DATABASE_NAME, 'healthy-manual-transfer')).toMatchObject({
		title: 'Healthy manual transfer',
	});
});

test('the sender reports that a selected project was deleted from another tab', async ({ context, page }) => {
	const edit = await context.newPage();
	try {
		const editor = await bootEditor(edit, `${SOUNDSCAPER_ORIGIN}/embed/en/`);
		await importFiles(editor, [toneA]);
		const projectId = await editor.getAttribute('data-project-id');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.goto(`${SOUNDSCAPER_ORIGIN}/transfer/send/`);
		await page.getByRole('button', { name: 'Find my projects', exact: true }).click();
		await page.locator('input[data-transfer-choice]').check();
		await chooseNestedCommandAction(edit, editor, 'File', ['Project management', 'Delete project']);
		await edit.getByRole('dialog', { name: 'Delete this project?', exact: true })
			.getByRole('button', { name: 'Delete permanently', exact: true }).click();
		await expect(editor).not.toHaveAttribute('data-project-id', projectId);
		await waitForProjectActivation(editor);
		await page.getByRole('button', { name: 'Download the ticked archives' }).click();
		await expect(page.locator('li[data-outcome="failed"]')).toContainText('no longer available');
		await expect(page.locator('[data-complete]')).toHaveAttribute('data-complete', 'false');
	} finally { await edit.close(); }
});

test('the built product origins exchange independent editable copies in both directions', async ({ context }) => {
	await assertTransferResponsePolicies(context.request);
	await exerciseEditableCopy(context, {
		sourceOrigin: SOUNDSCAPER_ORIGIN,
		destinationOrigin: FRAMESCAPER_ORIGIN,
		sourceProduct: 'soundscaper',
		destinationProduct: 'framescaper',
		sourceDatabase: SOUNDSCAPER_DATABASE_NAME,
		destinationDatabase: FRAMESCAPER_DATABASE_NAME,
		media: longTone,
		destinationMedia: toneB,
		renamedClip: 'Framescaper editable copy',
	});
	await exerciseEditableCopy(context, {
		sourceOrigin: FRAMESCAPER_ORIGIN,
		destinationOrigin: SOUNDSCAPER_ORIGIN,
		sourceProduct: 'framescaper',
		destinationProduct: 'soundscaper',
		sourceDatabase: FRAMESCAPER_DATABASE_NAME,
		destinationDatabase: SOUNDSCAPER_DATABASE_NAME,
		media: longTone,
		destinationMedia: toneA,
		renamedClip: 'Soundscaper editable copy',
	});
});

test('a blocked editable-copy popup recovers through downloaded archive and report sidecar', async ({ context }) => {
	const source = await context.newPage();
	let receiver = null;
	try {
		const editor = await bootEditor(source, `${SOUNDSCAPER_ORIGIN}/embed/en/`);
		await importFiles(editor, [longTone]);
		await expect(clipByName(editor, longTone.name)).toBeVisible();
		const sourceProjectId = await editor.getAttribute('data-project-id');
		expect(sourceProjectId).toBeTruthy();
		await saveProject(source, editor);
		const sourceBefore = JSON.stringify(await persistedProject(
			source, SOUNDSCAPER_DATABASE_NAME, sourceProjectId,
		));
		expect(sourceBefore).not.toBe('null');

		await editor.getByRole('menuitem', { name: 'File', exact: true }).click();
		await source.getByRole('menu', { name: 'File', exact: true })
			.getByRole('menuitem', { name: /^Edit in Framescaper/u }).click();
		await expect(source).toHaveURL((url) => (
			url.origin === SOUNDSCAPER_ORIGIN && url.pathname === '/transfer/send/'
		));
		const intent = launchIntent(source.url());
		await expect(source.locator('input[data-transfer-choice]:checked')).toHaveCount(1);
		await source.evaluate(() => { window.open = () => null; });
		const popups = [];
		source.on('popup', (popup) => { popups.push(popup); });
		await source.getByRole('button', {
			name: `Send the ticked projects to ${FRAMESCAPER_ORIGIN}`,
			exact: true,
		}).click();
		await source.getByRole('button', { name: 'Yes, send it', exact: true }).click();
		await expect(source.getByRole('status')).toContainText('The browser blocked the transfer popup.');
		expect(popups).toHaveLength(0);
		expect(JSON.stringify(await persistedProject(source, SOUNDSCAPER_DATABASE_NAME, sourceProjectId)))
			.toBe(sourceBefore);
		receiver = await context.newPage();
		await receiver.goto(`${FRAMESCAPER_ORIGIN}/transfer/receive/`);
		await expect(receiver.getByRole('heading', {
			name: 'Receive projects from the other product', exact: true,
		})).toBeVisible();
		await expect(receiver.getByLabel('Import downloaded project archives and conversion-report sidecars'))
			.toBeVisible();
		const downloads = [];
		source.on('download', (download) => { downloads.push(download); });
		await source.getByRole('button', { name: 'Download the ticked archives', exact: true }).click();
		await expect(source.getByText('Downloaded 1 of 1 projects.', { exact: false })).toBeVisible();
		await expect.poll(() => downloads.length).toBe(2);
		const archiveDownload = downloads.find((download) => /\.fscape$/u.test(download.suggestedFilename()));
		const sidecarDownload = downloads.find((download) => /\.conversion-report\.json$/u.test(download.suggestedFilename()));
		expect(archiveDownload).toBeTruthy();
		expect(sidecarDownload).toBeTruthy();
		const archiveName = archiveDownload.suggestedFilename();
		const sidecarName = sidecarDownload.suggestedFilename();
		expect(sidecarName).toBe(`${archiveName}.conversion-report.json`);
		const archiveBytes = await readFile(await archiveDownload.path());
		const sidecarBytes = await readFile(await sidecarDownload.path());
		const sidecar = JSON.parse(sidecarBytes.toString('utf8'));
		expect(sidecar).toMatchObject({
			kind: 'cross-product-editable-copy-report-sidecar',
			entryId: intent.destination.projectId,
			archiveByteLength: archiveBytes.byteLength,
			report: {
				kind: 'cross-product-editable-copy-report',
				refused: false,
				source: { projectId: sourceProjectId, schemaFamily: 'soundscaper' },
				destination: { projectId: intent.destination.projectId, schemaFamily: 'framescaper' },
			},
		});
		expect(sidecar.archiveSha256).toBe(createHash('sha256').update(archiveBytes).digest('hex'));
		await expect(source.getByRole('listitem').filter({ hasText: sidecarName })).toBeVisible();

		const repeatedArchiveName = archiveName.replace(/\.fscape$/u, ' (1).fscape');
		const repeatedSidecarName = sidecarName.replace(/\.json$/u, ' (1).json');
		await receiver.getByLabel('Import downloaded project archives and conversion-report sidecars')
			.setInputFiles([
				{ name: repeatedArchiveName, mimeType: 'application/octet-stream', buffer: archiveBytes },
				{ name: repeatedSidecarName, mimeType: 'application/json', buffer: sidecarBytes },
			]);
		await expect(receiver.getByText(/Imported 1 of 1 archive\. Conversion ledger: 1 invocation, \d+ classified roots\./u))
			.toBeVisible();
		await expect(receiver.getByRole('listitem').filter({ hasText: `${sourceProjectId} /` })
			.filter({ hasText: /^.+ — copy:/u }).first()).toBeVisible();
		await expect.poll(
			() => persistedProject(receiver, FRAMESCAPER_DATABASE_NAME, intent.destination.projectId),
			{ timeout: 30_000 },
		).not.toBeNull();
		expect(await persistedProject(receiver, FRAMESCAPER_DATABASE_NAME, sourceProjectId)).toBeNull();
		expect(JSON.stringify(await persistedProject(source, SOUNDSCAPER_DATABASE_NAME, sourceProjectId)))
			.toBe(sourceBefore);

		const destinationEditor = await bootEditor(
			receiver,
			`${FRAMESCAPER_ORIGIN}/embed/en/?project=${encodeURIComponent(intent.destination.projectId)}`,
		);
		await expect(destinationEditor).toHaveAttribute('data-product', 'framescaper');
		await expect(destinationEditor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
		await expect(clipByName(destinationEditor, longTone.name)).toBeVisible();
	} finally {
		if (process.env.SCAPE_BROWSER_COVERAGE !== '1') {
			for (const page of [receiver, source]) {
				if (page && !page.isClosed()) await page.close({ runBeforeUnload: false });
			}
		}
	}
});

async function exerciseEditableCopy(context, options) {
	const source = await context.newPage();
	let receiver = null;
	let sourceVerifier = null;
	try {
		const editor = await bootEditor(source, `${options.sourceOrigin}/embed/en/`);
		await expect(editor).toHaveAttribute('data-product', options.sourceProduct);
		await importFiles(editor, [options.media]);
		await expect(clipByName(editor, options.media.name)).toBeVisible();
		const sourceProjectId = await editor.getAttribute('data-project-id');
		expect(sourceProjectId).toBeTruthy();
		await saveProject(source, editor);
		const sourceBefore = await persistedProject(source, options.sourceDatabase, sourceProjectId);
		expect(sourceBefore).not.toBeNull();
		const sourceBytesBefore = JSON.stringify(sourceBefore);

		await editor.getByRole('menuitem', { name: 'File', exact: true }).click();
		const action = source.getByRole('menu', { name: 'File', exact: true })
			.getByRole('menuitem', { name: new RegExp(`^Edit in ${productName(options.destinationProduct)}`) });
		await expect(action).toBeEnabled();
		await action.click();
		await expect(source).toHaveURL((url) => (
			url.origin === options.sourceOrigin
			&& url.pathname === '/transfer/send/'
			&& url.searchParams.has('handoff')
		));
		const intent = launchIntent(source.url());
		expect(intent).toMatchObject({
			kind: 'cross-product-editable-copy',
			version: 1,
			source: {
				projectId: sourceProjectId,
				schemaFamily: options.sourceProduct,
				schemaVersion: 1,
			},
			destination: {
				schemaFamily: options.destinationProduct,
				schemaVersion: 1,
			},
		});
		expect(intent.destination.projectId).not.toBe(sourceProjectId);

		const chosen = source.locator('input[data-transfer-choice]:checked');
		await expect(chosen).toHaveCount(1);
		await source.getByRole('button', {
			name: `Send the ticked projects to ${options.destinationOrigin}`,
			exact: true,
		}).click();
		await expect(source.getByText(
			`Send 1 project to ${options.destinationOrigin}? Nothing is removed from this origin.`,
			{ exact: true },
		)).toBeVisible();
		const receiverOpened = source.waitForEvent('popup');
		await source.getByRole('button', { name: 'Yes, send it', exact: true }).click();
		receiver = await receiverOpened;
		await expect(receiver).toHaveURL(`${options.destinationOrigin}/transfer/receive/`);
		expect(await receiver.evaluate(() => globalThis.opener !== null)).toBe(true);
		await expect(receiver.getByRole('heading', {
			name: 'Receive projects from the other product', exact: true,
		})).toBeVisible();

		await expect(source.getByText('Sent 1 of 1 projects.', { exact: false })).toBeVisible();
		await expect(receiver.getByText(/Imported 1 of 1 archives?\./u)).toBeVisible();
		await expect(receiver.getByText(/Conversion ledger: 1 invocation, \d+ classified roots\./u))
			.toBeVisible();
		const conversionRows = receiver.getByRole('listitem')
			.filter({ hasText: `${sourceProjectId} /` });
		await expect(conversionRows.filter({ hasText: /^.+ — copy:/u }).first()).toBeVisible();
		await expect(conversionRows.filter({ hasText: /^.+ — omit-with-report:/u }).first()).toBeVisible();

		await expect.poll(
			() => persistedProject(receiver, options.destinationDatabase, intent.destination.projectId),
			{ timeout: 30_000 },
		).not.toBeNull();
		expect(await persistedProject(source, options.sourceDatabase, intent.destination.projectId)).toBeNull();
		expect(await persistedProject(receiver, options.destinationDatabase, sourceProjectId)).toBeNull();
		expect(JSON.stringify(await persistedProject(source, options.sourceDatabase, sourceProjectId)))
			.toBe(sourceBytesBefore);

		const destinationEditor = await bootEditor(
			receiver,
			`${options.destinationOrigin}/embed/en/?project=${encodeURIComponent(intent.destination.projectId)}`,
		);
		await expect(destinationEditor).toHaveAttribute('data-product', options.destinationProduct);
		await expect(destinationEditor).toHaveAttribute('data-project-id', intent.destination.projectId);
		await expect(destinationEditor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
		const copiedClip = clipByName(destinationEditor, options.media.name);
		await expect(copiedClip).toBeVisible();
		if (await destinationEditor.locator('[data-workspace-panel="project-bin"]').isVisible()) {
			await closeWorkspacePanel(destinationEditor, 'project-bin');
		}
		await startPlayback(destinationEditor);
		await destinationEditor.locator('[data-transport="stop"]')
			.getByRole('button', { name: 'Stop', exact: true }).click();
		await copiedClip.locator('.clip-header__name').dblclick();
		const nameInput = copiedClip.getByRole('textbox', { name: 'Clip name', exact: true });
		await expect(nameInput).toBeFocused();
		await nameInput.fill(options.renamedClip);
		await nameInput.press('Enter');
		await expect(clipByName(destinationEditor, options.renamedClip)).toBeVisible();
		await importFiles(destinationEditor, [options.destinationMedia]);
		await expect(clipByName(destinationEditor, options.destinationMedia.name)).toBeVisible();
		await saveProject(receiver, destinationEditor);
		const destinationMediaTitle = options.destinationMedia.name.replace(/\.[^.]+$/u, '');
		await expect.poll(async () => {
			const destination = await persistedProject(
				receiver, options.destinationDatabase, intent.destination.projectId,
			);
			return destination?.clips?.map(({ title }) => title) ?? [];
		}).toEqual(expect.arrayContaining([options.renamedClip, destinationMediaTitle]));

		sourceVerifier = await context.newPage();
		const reopenedSource = await bootEditor(
			sourceVerifier,
			`${options.sourceOrigin}/embed/en/?project=${encodeURIComponent(sourceProjectId)}`,
		);
		await expect(clipByName(reopenedSource, options.media.name)).toBeVisible();
		await expect(clipByName(reopenedSource, options.renamedClip)).toHaveCount(0);
		await expect(clipByName(reopenedSource, options.destinationMedia.name)).toHaveCount(0);
		await startPlayback(reopenedSource);
		await reopenedSource.locator('[data-transport="stop"]')
			.getByRole('button', { name: 'Stop', exact: true }).click();
		expect(JSON.stringify(await persistedProject(sourceVerifier, options.sourceDatabase, sourceProjectId)))
			.toBe(sourceBytesBefore);
	} finally {
		// The coverage fixture snapshots live pages after the test body returns.
		// Ordinary runs still close each direction promptly; instrumented runs let
		// the owning context close them after its final precise-coverage take.
		if (process.env.SCAPE_BROWSER_COVERAGE !== '1') {
			for (const page of [sourceVerifier, receiver, source]) {
				if (page && !page.isClosed()) await page.close({ runBeforeUnload: false });
			}
		}
	}
}

async function startPlayback(editor) {
	const transport = editor.locator('[data-transport="play"]');
	const play = transport.getByRole('button', { name: 'Play', exact: true });
	const pause = transport.getByRole('button', { name: 'Pause', exact: true });
	for (let attempt = 0; attempt < 2; attempt += 1) {
		await play.click();
		try {
			await expect(pause).toBeVisible();
			return;
		} catch (error) {
			// A project hydration can overtake a Play press. Retry only while the
			// transport is still stopped; a second miss remains a real failure.
			if (attempt === 1 || !(await play.isVisible())) throw error;
		}
	}
}

async function assertTransferResponsePolicies(request) {
	for (const origin of [SOUNDSCAPER_ORIGIN, FRAMESCAPER_ORIGIN]) {
		const sender = await request.get(`${origin}/transfer/send/`);
		expect(sender.status()).toBe(200);
		expect(sender.headers()['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
		expect(sender.headers()['cross-origin-embedder-policy']).toBe('credentialless');
		const receiver = await request.get(`${origin}/transfer/receive/`);
		expect(receiver.status()).toBe(200);
		expect(receiver.headers()['cross-origin-opener-policy']).toBe('unsafe-none');
		expect(receiver.headers()['cross-origin-embedder-policy']).toBe('credentialless');
	}
	const retired = await request.get(`${SOUNDSCAPER_ORIGIN}/framescaper/en/`, { maxRedirects: 0 });
	expect(retired.status()).toBe(301);
	expect(retired.headers().location).toBe('https://framescaper.org/en/');
}

function productName(productId) {
	return productId === 'framescaper' ? 'Framescaper' : 'Soundscaper';
}

function launchIntent(url) {
	const encoded = new URL(url).searchParams.get('handoff');
	expect(encoded).toBeTruthy();
	return JSON.parse(encoded);
}

async function saveProject(page, editor) {
	await chooseFileAction(page, editor, 'Save project');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
}

async function persistedProject(page, databaseName, projectId) {
	return page.evaluate(({ name, id }) => new Promise((resolve, reject) => {
		const open = indexedDB.open(name);
		open.onerror = () => reject(open.error || new Error(`Could not open ${name}.`));
		open.onsuccess = () => {
			const database = open.result;
			if (!database.objectStoreNames.contains('projects')) {
				database.close();
				resolve(null);
				return;
			}
			const read = database.transaction('projects').objectStore('projects').get(id);
			read.onerror = () => {
				database.close();
				reject(read.error || new Error(`Could not read ${id}.`));
			};
			read.onsuccess = () => {
				const project = read.result;
				database.close();
				resolve(project ? JSON.parse(JSON.stringify(project)) : null);
			};
		};
	}), { name: databaseName, id: projectId });
}
