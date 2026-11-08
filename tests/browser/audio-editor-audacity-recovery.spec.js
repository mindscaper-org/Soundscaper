/* SPDX-License-Identifier: AGPL-3.0-only */

import { setTimeout as delay } from 'node:timers/promises';
import initSqlJs from 'sql.js';
import { createAup3Fixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, closeAup4CompatibilityReport,
	collectClientErrors, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { decodeAudacityBinaryXml } from '../../src/common/editor/audacity-binary-xml.js';
import { decodeAudacityProjectTree } from '../../src/common/editor/aup4-conversion.js';
import { initializeAup4Database, insertAup4SampleBlock, readAup4SampleBlock, writeAup4Document } from '../../src/common/editor/aup4-database.js';
import { createAup4SampleBlock } from '../../src/common/editor/aup4-profile.js';
import { projectWithBlocks } from '../helpers/aup4-database-harness.js';

test.afterEach(async ({ page }, testInfo) => {
	await attachRecoveryWorkerDiagnostics(page, testInfo);
});

test('File Open recovers missing AUP3 audio as timed silence and exports an editable repaired copy', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	await observeWorkerRecovery(page);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	const bytes = await createAup3Fixture({ tracks: [{ name: 'Recoverable recording', clips: [{ offset: 2,
		blocks: [{ id: 1, samples: [0.25, -0.5] }, { id: 2, samples: [0.75, 0.5, 0.25], missing: true },
			{ id: 3, samples: [-0.25] }] }] }] });
	await openThroughMenu(page, editor, 'missing-block.aup3', bytes);
	await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
	expect(await page.evaluate(() => globalThis.__audacityRecoveryOpenRequests)).toEqual([false, true]);
	await editor.getByRole('region', { name: 'AUP3 Compatibility Report', exact: true })
		.getByRole('button', { name: 'View report', exact: true }).click();
	const report = page.getByRole('dialog', { name: 'AUP3 Compatibility Report', exact: true });
	await expect(report).toContainText('3 of 3 samples were replaced with silence');
	await expect(report).toContainText('original Audacity file is unchanged');
	await closeAup4CompatibilityReport(report);
	const copy = await exportAudacityCopy(page, editor);
	expect(copy.project.clips[0].timelineStartFrame).toBe(96_000);
	expect(copy.project.clips[0].durationFrames).toBe(6);
	expect(Array.from(copy.sources[0].channels[0])).toEqual([0.25, -0.5, 0, 0, 0, -0.25]);
	// Lazy recovery imports must not install a second worker dispatcher.
	expect(await page.evaluate(() => globalThis.__audacityRecoveryDuplicateReplies)).toEqual([]);
	expect(errors).toEqual([]);
});

test('File Open drops a damaged autosave in its private copy and recovers the saved AUP3 document', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	await observeWorkerRecovery(page);
	const editor = await bootEditor(page, '/embed/en/');
	const SQL = await initSqlJs();
	const database = new SQL.Database(await createAup3Fixture({ SQL, autosave: true }));
	let bytes;
	try {
		database.run('UPDATE autosave SET doc = substr(doc, 1, length(doc) - 1)');
		bytes = database.export();
	} finally { database.close(); }
	await openThroughMenu(page, editor, 'damaged-autosave.aup3', bytes);
	await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
	expect(await page.evaluate(() => globalThis.__audacityRecoveryOpenRequests)).toEqual([false, true]);
	await editor.getByRole('region', { name: 'AUP3 Compatibility Report', exact: true })
		.getByRole('button', { name: 'View report', exact: true }).click();
	const report = page.getByRole('dialog', { name: 'AUP3 Compatibility Report', exact: true });
	await expect(report).toContainText('Used the project document');
	await expect(report).toContainText('Unreadable project documents and edits available only in them were not recovered');
	await closeAup4CompatibilityReport(report);
	const copy = await exportAudacityCopy(page, editor);
	expect(Array.from(copy.sources[0].channels[0])).toEqual([0.25, -0.5, 0.75, 0]);
});

test('File Open recovers an AUP4 history document when autosave and saved documents are damaged', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const SQL = await initSqlJs();
	const database = new SQL.Database();
	let bytes;
	try {
		initializeAup4Database(database);
		const blockId = insertAup4SampleBlock(database, createAup4SampleBlock(Float32Array.of(0.25, -0.5)));
		writeAup4Document(database, projectWithBlocks(blockId, 2), { autosave: false });
		writeAup4Document(database, projectWithBlocks(blockId, 2), { autosave: false });
		writeAup4Document(database, projectWithBlocks(blockId, 2));
		database.run('UPDATE autosave SET doc = x\'ff\'');
		database.run('UPDATE project SET doc = x\'ff\'');
		database.run('UPDATE project_history SET doc = x\'ff\' WHERE generation = 2');
		bytes = database.export();
	} finally { database.close(); }
	await openThroughMenu(page, editor, 'damaged-project-history.aup4', bytes);
	await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
	await editor.getByRole('region', { name: 'AUP4 Compatibility Report', exact: true })
		.getByRole('button', { name: 'View report', exact: true }).click();
	const report = page.getByRole('dialog', { name: 'AUP4 Compatibility Report', exact: true });
	await expect(report).toContainText('Used saved history generation 1');
	await closeAup4CompatibilityReport(report);
	const copy = await exportAudacityCopy(page, editor);
	expect(Array.from(copy.sources[0].channels[0])).toEqual([0.25, -0.5]);
});

test('File Open salvages readable AUP4 rows despite a structurally damaged history page', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	await observeWorkerRecovery(page);
	const editor = await bootEditor(page, '/embed/en/');
	const SQL = await initSqlJs();
	const database = new SQL.Database();
	let bytes;
	try {
		initializeAup4Database(database);
		const blockId = insertAup4SampleBlock(database, createAup4SampleBlock(Float32Array.of(0.25, -0.5)));
		writeAup4Document(database, projectWithBlocks(blockId, 2), { autosave: false });
		const historyPage = Number(database.exec("SELECT rootpage FROM sqlite_master WHERE name = 'project_history'")[0].values[0][0]);
		bytes = database.export();
		const pageSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(16);
		bytes[(historyPage - 1) * pageSize] = 0xff;
	} finally { database.close(); }
	await openThroughMenu(page, editor, 'damaged-history-page.aup4', bytes);
	await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
	expect(await page.evaluate(() => globalThis.__audacityRecoveryOpenRequests)).toEqual([false, true]);
	await editor.getByRole('region', { name: 'AUP4 Compatibility Report', exact: true })
		.getByRole('button', { name: 'View report', exact: true }).click();
	const report = page.getByRole('dialog', { name: 'AUP4 Compatibility Report', exact: true });
	await expect(report).toContainText('SQLite reported structural damage');
	await closeAup4CompatibilityReport(report);
	const copy = await exportAudacityCopy(page, editor);
	expect(Array.from(copy.sources[0].channels[0])).toEqual([0.25, -0.5]);
});

async function observeWorkerRecovery(page) {
	await page.addInitScript(() => {
		const NativeWorker = globalThis.Worker;
		globalThis.__audacityRecoveryOpenRequests = [];
		globalThis.__audacityRecoveryDuplicateReplies = [];
		const events = [], unanswered = new Map(), workerIds = new WeakMap();
		let workerSequence = 0, totalEvents = 0, collectionErrors = 0, unansweredEvictions = 0;
		const clip = (value) => typeof value === 'string' ? value.slice(0, 64) : null;
		const key = (worker, id) => `${worker}:${id}`;
		const record = (worker, kind, fields = {}) => {
			events.push({ sequence: ++totalEvents, at: performance.now(), worker, kind, ...fields });
			if (events.length > 64) events.shift();
		};
		const request = (worker, message) => {
			try {
				const id = clip(message?.id), type = clip(message?.type);
				const fields = { id, type, recover: type === 'open-file' ? message.args?.recover === true : null };
				record(worker, 'request', fields);
				if (id && type !== 'cancel') {
					unanswered.set(key(worker, id), { worker, ...fields, at: performance.now() });
					if (unanswered.size > 64) {
						unanswered.delete(unanswered.keys().next().value);
						unansweredEvictions++;
					}
				}
			} catch { collectionErrors++; }
		};
		const reply = (worker, message) => {
			try {
				const id = clip(message?.id), pending = unanswered.get(key(worker, id));
				const fields = { id, type: pending?.type ?? null };
				if (message?.progress) {
					record(worker, 'progress', { ...fields, phase: clip(message.progress.phase),
						value: Number.isFinite(message.progress.value) ? message.progress.value : null });
				} else {
					record(worker, message?.error ? 'reply-error' : 'reply-result', { ...fields,
						errorName: clip(message?.error?.name), errorCode: clip(message?.error?.code) });
					unanswered.delete(key(worker, id));
				}
			} catch { collectionErrors++; }
		};
		Object.defineProperty(globalThis, '__audacityRecoveryWorkerDiagnostic', { value: { read: () => {
			const retained = [...events], pending = [...unanswered.values()];
			const requests = globalThis.__audacityRecoveryOpenRequests;
			for (;;) {
				const body = JSON.stringify({ available: true, eventCapacity: 64, unansweredCapacity: 64,
					totalEvents, droppedEvents: totalEvents - retained.length,
					unansweredEvictions, unansweredOmitted: unanswered.size - pending.length,
					collectionErrors, events: retained, unansweredRequests: pending,
					openRequests: requests.slice(-128), openRequestCount: requests.length,
					openRequestsOmitted: Math.max(0, requests.length - 128), byteLimit: 32_768 });
				if (new TextEncoder().encode(body).byteLength <= 32_768) return body;
				if (retained.length) retained.shift();
				else if (pending.length) pending.shift();
				else return JSON.stringify({ available: false, reason: 'Recovery diagnostic exceeded its byte bound.' });
			}
		} } });
		globalThis.Worker = class extends NativeWorker {
			constructor(url, options) {
				super(url, options); this.audacity = options?.name === 'kw-media-audacity-projects';
				if (this.audacity) {
					const replies = new Set();
					this.addEventListener('message', ({ data }) => {
						if (!data.id || data.progress) return;
						if (replies.has(data.id)) globalThis.__audacityRecoveryDuplicateReplies.push(data.id);
						replies.add(data.id);
					});
					try {
						const worker = ++workerSequence;
						workerIds.set(this, worker);
						this.addEventListener('message', (event) => reply(worker, event.data));
						for (const kind of ['error', 'messageerror']) this.addEventListener(kind, () => {
							try { record(worker, kind); } catch { collectionErrors++; }
						});
					} catch { collectionErrors++; }
				}
			}
			postMessage(message, ...options) {
				if (this.audacity && message.type === 'open-file') globalThis.__audacityRecoveryOpenRequests.push(message.args.recover === true);
				const result = super.postMessage(message, ...options);
				if (this.audacity) request(workerIds.get(this), message);
				return result;
			}
		};
	});
}

async function attachRecoveryWorkerDiagnostics(page, testInfo) {
	if (testInfo.status === testInfo.expectedStatus) return;
	const deadline = new AbortController();
	let body;
	try {
		body = await Promise.race([
			page.evaluate(() => globalThis.__audacityRecoveryWorkerDiagnostic?.read()
				?? JSON.stringify({ available: false, reason: 'Recovery worker recorder was not installed in this document.' })),
			delay(1_000, JSON.stringify({ available: false, reason: 'Recovery diagnostic read deadline exceeded.' }),
				{ signal: deadline.signal, ref: false }),
		]);
		if (Buffer.byteLength(body) > 32_768) throw new Error('Recovery diagnostic exceeded its byte bound.');
		JSON.parse(body);
	} catch (error) {
		body = JSON.stringify({ available: false, error: String(error).slice(0, 512) });
	} finally { deadline.abort(); }
	await testInfo.attach('audacity-recovery-worker-diagnostics', { body, contentType: 'application/json' }).catch(() => undefined);
}

async function openThroughMenu(page, editor, name, bytes) {
	const chooser = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await chooser).setFiles({ name, mimeType: 'application/x-audacity-project', buffer: Buffer.from(bytes) });
}

async function exportAudacityCopy(page, editor) {
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export AUP4']);
	const bytes = await downloadBytes(await downloading);
	const SQL = await initSqlJs();
	const database = new SQL.Database(bytes);
	try {
		const [[dictionary, document]] = database.exec('SELECT dict, doc FROM project WHERE id = 1')[0].values;
		return await decodeAudacityProjectTree(decodeAudacityBinaryXml(dictionary, document).root,
			(blockId) => readAup4SampleBlock(database, blockId));
	} finally { database.close(); }
}
