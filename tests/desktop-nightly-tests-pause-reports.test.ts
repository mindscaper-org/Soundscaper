/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { constants } from 'node:buffer';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { TextReader, TextWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';

import { retainNightlyTestsBlob } from '../desktop/nightly-tests-pause-reports.ts';

const payloadRoot = fileURLToPath(new URL('..', import.meta.url));

test('retained reports preserve attachments, verdicts, and UTF-8 output across streamed records', async (context) => {
	const root = await fixtureRoot(context);
	const paths = reportPaths(root);
	const emoji = Buffer.from('🎧');
	const localizedOutput = '音声 🎧\n'.repeat(12_000);
	const events = [
		{ method: 'onBlobReportMetadata', params: { version: 2 } },
		{ method: 'onProject', params: { project: { suites: [{ entries: [
			{ entries: [{ testId: 'completed' }, { testId: 'canceled' }] },
			{ entries: [{ testId: 'canceled' }] },
		] }] } } },
		{ method: 'onTestBegin', params: { testId: 'completed' } },
		{ method: 'onTestEnd', params: { test: { testId: 'completed' }, result: { status: 'failed' } } },
		{ method: 'onStdIO', params: { testId: 'canceled', data: 'CANCELED_EVIDENCE' } },
		{ method: 'onStdIO', params: { testId: 'completed', data: localizedOutput } },
		...[emoji.subarray(0, 2), emoji.subarray(2)].map((part) => ({ method: 'onStdIO',
			params: { testId: 'completed', data: part.toString('base64'), isBase64: true } })),
		{ method: 'onStdIO', params: { data: '\nglobal output\n' } },
		{ method: 'onTestEnd', params: { test: { testId: 'canceled' }, result: { status: 'interrupted' } } },
		{ method: 'onEnd', params: { result: { status: 'interrupted' } } },
	];
	const bytes = Buffer.from(events.map((event) => JSON.stringify(event)).join('\r\n'));
	const writer = new ZipWriter(new Uint8ArrayWriter());
	await writer.add('resources/evidence.txt', new TextReader('verified evidence'));
	await writer.add('report.jsonl', new ReadableStream<Uint8Array>({
		start(controller) {
			for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.subarray(offset, offset + 7));
			controller.close();
		},
	}));
	await writeFile(paths.source, await writer.close());
	await writeFile(paths.consoleLog, 'previous attempt\n');
	await retainNightlyTestsBlob({ ...paths, completed: new Set(['completed']), status: 'failed', payloadRoot });
	assert.equal(await readFile(paths.consoleLog, 'utf8'), `previous attempt\n${localizedOutput}🎧\nglobal output\n`);
	const retained = await readReport(paths.destination);
	const expected = events.filter((event) => !JSON.stringify(event).includes('canceled'));
	expected.splice(1, 0, { method: 'onProject', params: { project: { suites: [
		{ entries: [{ entries: [{ testId: 'completed' }] }] },
	] } } });
	expected.at(-1)!.params = { result: { status: 'failed' } };
	assert.deepEqual(retained.events, expected);
	assert.equal(retained.attachment, 'verified evidence');
});

test('a report larger than the V8 string limit retains completed tests without decoding the entire report', async (context) => {
	const root = await fixtureRoot(context);
	const paths = reportPaths(root);
	const discarded = Buffer.from(`${JSON.stringify({ method: 'onStdIO', params: {
		testId: 'canceled', data: 'x'.repeat(64 * 1024),
	} })}\n`);
	const count = Math.ceil((constants.MAX_STRING_LENGTH + 1) / discarded.length);
	assert.ok(count * discarded.length > constants.MAX_STRING_LENGTH);
	const kept = { method: 'onStdIO', params: { testId: 'completed', data: 'COMPLETE\n' } };
	let remaining = count;
	const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
	await writer.add('report.jsonl', new ReadableStream<Uint8Array>({
		pull(controller) {
			if (remaining-- > 0) controller.enqueue(discarded);
			else {
				controller.enqueue(Buffer.from(JSON.stringify(kept)));
				controller.close();
			}
		},
	}));
	await writer.add('resources/evidence.txt', new TextReader('large report evidence'));
	await writeFile(paths.source, await writer.close());
	await retainNightlyTestsBlob({ ...paths, completed: new Set(['completed']), status: 'passed', payloadRoot });
	assert.equal(await readFile(paths.consoleLog, 'utf8'), 'COMPLETE\n');
	assert.deepEqual(await readReport(paths.destination), { events: [kept], attachment: 'large report evidence' });
});

test('invalid report records reject without leaving either ZIP stream running', { timeout: 10_000 }, async (context) => {
	const root = await fixtureRoot(context);
	const paths = reportPaths(root);
	const writer = new ZipWriter(new Uint8ArrayWriter());
	await writer.add('report.jsonl', new TextReader('{"method":"onBegin"}\n{broken'));
	await writeFile(paths.source, await writer.close());
	await assert.rejects(retainNightlyTestsBlob({
		...paths, completed: new Set(), status: 'passed', payloadRoot,
	}), SyntaxError);
});

async function fixtureRoot(context: test.TestContext): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'nightly-pause-reports-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

function reportPaths(root: string) {
	return { source: join(root, 'attempt.zip'), destination: join(root, 'retained.zip'), consoleLog: join(root, 'console.log') };
}

async function readReport(path: string) {
	const reader = new ZipReader(new Uint8ArrayReader(await readFile(path)));
	try {
		const entries = await reader.getEntries();
		const report = entries.find((entry) => entry.filename === 'report.jsonl');
		const attachment = entries.find((entry) => entry.filename === 'resources/evidence.txt');
		assert.ok(report && !report.directory && attachment && !attachment.directory);
		return {
			events: (await report.getData(new TextWriter())).trim().split('\n').map((line) => JSON.parse(line) as unknown),
			attachment: await attachment.getData(new TextWriter()),
		};
	} finally {
		await reader.close();
	}
}
