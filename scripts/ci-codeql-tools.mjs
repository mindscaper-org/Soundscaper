#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

// CodeQL bootstrap runs without npm ci; this closure uses Node built-ins only.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { appendFile, lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { downloadCiBytes } from './lib/ci-download-retry.mjs';
import { fileDigest } from './lib/verified-ci-input-tree.ts';

const ROOT = resolve(import.meta.dirname, '..');
/** @typedef {{schemaVersion: number, actionRevision: string, version: string, url: string, byteLength: number, sha256: string}} CodeqlToolsPin */
/** @type {Readonly<CodeqlToolsPin>} */
export const CODEQL_TOOLS = Object.freeze(JSON.parse(readFileSync(new URL('../config/codeql-tools.json', import.meta.url), 'utf8')));

/**
 * Only authenticated tarballs are handed to CodeQL's supported local tools input.
 * @param {{directory?: string, pin?: Readonly<CodeqlToolsPin>, fetchImpl?: typeof fetch}} [options]
 */
export async function prepareCodeqlTools({
	directory = resolve(ROOT, '.wrangler/ci-input-cache/codeql'),
	pin = CODEQL_TOOLS,
	fetchImpl = globalThis.fetch,
} = {}) {
	await mkdir(directory, { recursive: true });
	const archive = resolve(directory, basename(new URL(pin.url).pathname));
	try {
		const metadata = await lstat(archive);
		if (metadata.isFile() && metadata.size === pin.byteLength && fileDigest(archive) === pin.sha256) return archive;
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}
	await rm(archive, { force: true });
	const staging = await mkdtemp(join(directory, '.download-'));
	try {
		const bytes = await downloadCiBytes(pin.url, { fetchImpl, maximumBytes: pin.byteLength, timeoutMs: 600_000 });
		if (bytes.length !== pin.byteLength || createHash('sha256').update(bytes).digest('hex') !== pin.sha256) {
			throw new Error('CodeQL tools archive failed its pinned integrity check.');
		}
		const temporary = join(staging, 'archive.tar.zst');
		await writeFile(temporary, bytes);
		await rename(temporary, archive);
		return archive;
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const archive = await prepareCodeqlTools();
	if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `archive=${archive}\n`);
	console.log(`Verified CodeQL ${CODEQL_TOOLS.version} tools: ${archive}`);
}
