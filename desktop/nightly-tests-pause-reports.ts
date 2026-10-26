/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

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
export async function retainNightlyTestsBlob({ source, destination, completed, status, payloadRoot }: {
	source: string; destination: string; completed: ReadonlySet<string>; status: string; payloadRoot: string;
}): Promise<string> {
	// The launcher ASAR has no third-party modules. Resolve ZIP support from the
	// already staged Playwright payload, which also owns this dependency.
	const require = createRequire(join(payloadRoot, 'package.json'));
	const zip = await import(pathToFileURL(require.resolve('@zip.js/zip.js')).href) as typeof import('@zip.js/zip.js');
	const reader = new zip.ZipReader(new zip.Uint8ArrayReader(await readFile(source)));
	const writer = new zip.ZipWriter(new zip.Uint8ArrayWriter());
	let consoleOutput = '';
	try {
		for (const entry of await reader.getEntries()) {
			if (entry.directory) continue;
			const bytes = await entry.getData!(new zip.Uint8ArrayWriter());
			if (entry.filename !== 'report.jsonl') {
				await writer.add(entry.filename, new zip.Uint8ArrayReader(bytes));
				continue;
			}
			const events = Buffer.from(bytes).toString('utf8').trim().split('\n')
				.map((line) => JSON.parse(line) as BlobEvent).filter((event) => {
					const id = event.params?.testId ?? event.params?.test?.testId;
					return id === undefined || completed.has(id);
				});
			for (const event of events) {
				if (event.params?.project) event.params.project.suites = prune(event.params.project.suites, completed);
				if (event.method === 'onEnd' && event.params?.result) event.params.result.status = status;
				if (event.method === 'onStdIO' && event.params?.data) {
					consoleOutput += event.params.isBase64 ? Buffer.from(event.params.data, 'base64').toString('utf8') : event.params.data;
				}
			}
			await writer.add(entry.filename, new zip.TextReader(`${events.map((event) => JSON.stringify(event)).join('\n')}\n`));
		}
		await writeFile(destination, await writer.close());
	} finally {
		await reader.close();
	}
	return consoleOutput;
}

function prune(entries: BlobEntry[], completed: ReadonlySet<string>): BlobEntry[] {
	return entries.filter((entry) => {
		if (entry.testId !== undefined) return completed.has(entry.testId);
		if (entry.entries) entry.entries = prune(entry.entries, completed);
		return (entry.entries?.length ?? 0) > 0;
	});
}
