/* SPDX-License-Identifier: AGPL-3.0-only */

import { open, type FileHandle } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { pathToFileURL } from 'node:url';

import type { FileEntry, ZipWriter } from '@zip.js/zip.js';

interface BlobEntry {
	testId?: string;
	entries?: BlobEntry[];
}

interface BlobEvent {
	method: string;
	params?: {
		testId?: string;
		test?: { testId: string };
		project?: { suites: BlobEntry[] };
		result?: { status: string };
		data?: string;
		isBase64?: boolean;
	};
}

/** Retain completed tests and their attachments, dropping canceled attempts. */
export async function retainNightlyTestsBlob({ source, destination, consoleLog, completed, status, payloadRoot }: {
	source: string; destination: string; consoleLog: string; completed: ReadonlySet<string>; status: string; payloadRoot: string;
}): Promise<void> {
	// The launcher ASAR has no third-party modules. Resolve ZIP support from the
	// already staged Playwright payload, which also owns this dependency.
	const require = createRequire(join(payloadRoot, 'package.json'));
	const zip = await import(pathToFileURL(require.resolve('@zip.js/zip.js')).href) as typeof import('@zip.js/zip.js');
	const input = await open(source, 'r');
	const handles = [input];
	try {
		const output = await open(destination, 'w');
		handles.push(output);
		const consoleOutput = await open(consoleLog, 'a');
		handles.push(consoleOutput);
		const archive = new zip.Reader(input);
		archive.size = (await input.stat()).size;
		archive.readUint8Array = (offset, length) => readBytes(input, offset, length);
		const reader = new zip.ZipReader(archive);
		const writer = new zip.ZipWriter(new WritableStream<Uint8Array>({ write: (bytes) => output.writeFile(bytes) }));
		try {
			for await (const entry of reader.getEntriesGenerator()) {
				if (entry.directory) continue;
				const stream = entry.filename === 'report.jsonl'
					? retainedEvents(completed, status, consoleOutput) : new TransformStream<Uint8Array, Uint8Array>();
				await copyEntry(entry, writer, stream);
			}
			await writer.close();
		} finally {
			await reader.close();
		}
	} finally {
		await Promise.all(handles.map((handle) => handle.close()));
	}
}

async function readBytes(handle: FileHandle, offset: number, length: number): Promise<Uint8Array> {
	const bytes = new Uint8Array(length);
	let read = 0;
	while (read < length) {
		const { bytesRead } = await handle.read(bytes, read, length - read, offset + read);
		if (bytesRead === 0) break;
		read += bytesRead;
	}
	return bytes.subarray(0, read);
}

async function copyEntry(entry: FileEntry, writer: ZipWriter<unknown>, stream: TransformStream<Uint8Array, Uint8Array>): Promise<void> {
	const abort = new AbortController();
	const operations = [
		entry.getData(stream.writable, { signal: abort.signal }),
		writer.add(entry.filename, stream.readable, { signal: abort.signal }),
	];
	try {
		await Promise.all(operations);
	} catch (error) {
		abort.abort(error);
		await Promise.allSettled(operations);
		throw error;
	}
}

/** Bound report memory to one event and stream console bytes across attempts. */
function retainedEvents(completed: ReadonlySet<string>, status: string, consoleOutput: FileHandle): TransformStream<Uint8Array, Uint8Array> {
	const decoder = new StringDecoder('utf8');
	let pending = '';
	const emit = async (line: string, controller: TransformStreamDefaultController<Uint8Array>): Promise<void> => {
		if (!line.trim()) return;
		const event = JSON.parse(line) as BlobEvent;
		const id = event.params?.testId ?? event.params?.test?.testId;
		if (id !== undefined && !completed.has(id)) return;
		if (event.params?.project) event.params.project.suites = prune(event.params.project.suites, completed);
		if (event.method === 'onEnd' && event.params?.result) event.params.result.status = status;
		if (event.method === 'onStdIO' && event.params?.data) {
			await consoleOutput.writeFile(event.params.isBase64 ? Buffer.from(event.params.data, 'base64') : event.params.data);
		}
		controller.enqueue(Buffer.from(`${JSON.stringify(event)}\n`));
	};
	return new TransformStream<Uint8Array, Uint8Array>({
		async transform(bytes, controller) {
			const text = decoder.write(bytes);
			let offset = 0;
			for (let end = text.indexOf('\n'); end >= 0; end = text.indexOf('\n', offset)) {
				await emit(pending + text.slice(offset, end), controller);
				pending = '';
				offset = end + 1;
			}
			pending += text.slice(offset);
		},
		async flush(controller) { await emit(pending + decoder.end(), controller); },
	});
}

function prune(entries: BlobEntry[], completed: ReadonlySet<string>): BlobEntry[] {
	return entries.filter((entry) => {
		if (entry.testId !== undefined) return completed.has(entry.testId);
		if (entry.entries) entry.entries = prune(entry.entries, completed);
		return (entry.entries?.length ?? 0) > 0;
	});
}
