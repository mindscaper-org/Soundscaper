/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { Zip, ZipPassThrough } from 'fflate';

import { renameIntoPlaceExclusively } from './exclusive-rename.mjs';

const execute = promisify(execFile);
const MAXIMUM_SOURCE_BYTES = 512 * 1024 * 1024;
// Bound disk usage and stay below the classic ZIP writer's central-directory offset limit.
const MAXIMUM_BUNDLE_BYTES = 2 * 1024 ** 3;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u;
const SHA256 = /^[a-f\d]{64}$/u;

/** Publish one source download while preserving each authenticated inner archive. */
export async function stageDesktopReleaseSources({
	repositoryRoot, sourceRevision, sourceInputsRoot, outputRoot, inputs,
}) {
	if (!/^(?:[a-f\d]{40}|[a-f\d]{64})$/u.test(String(sourceRevision))) {
		throw new Error('The release source revision must be an exact Git commit.');
	}
	const sources = releaseSourceInputs(inputs);
	const name = 'sources.zip';
	let bundle;
	await renameIntoPlaceExclusively(resolve(outputRoot, name), 'Release source bundle', async (staging) => {
		const application = resolve(staging, 'application.zip');
		await execute('git', ['archive', '--format=zip', '--prefix=application/',
			`--output=${application}`, sourceRevision], { cwd: repositoryRoot });
		const stagedBundle = resolve(staging, name);
		bundle = await writeSourceBundle(stagedBundle, { application, sources, sourceInputsRoot, sourceRevision });
		return stagedBundle;
	});
	return { name, ...bundle };
}

function releaseSourceInputs(inputs) {
	const sources = new Map();
	for (const input of inputs) {
		if (!SAFE_NAME.test(String(input.name)) || typeof input.bundlePath !== 'string'
			|| !input.bundlePath.split('/').every((part) => SAFE_NAME.test(part))
			|| !/^(?:sdk|bundled-codecs)\//u.test(input.bundlePath)) {
			throw new Error('The release source archive path is invalid.');
		}
		if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 1
			|| input.byteLength > MAXIMUM_SOURCE_BYTES || !SHA256.test(String(input.sha256))) {
			throw new Error('Release source archive bytes or digest authority is invalid.');
		}
		const group = sources.get(input.bundlePath);
		if (group === undefined) sources.set(input.bundlePath, [input]);
		else if (group[0].sha256 !== input.sha256 || group[0].byteLength !== input.byteLength) {
			throw new Error(`Release source archives conflict at ${input.bundlePath}.`);
		} else if (!group.some(({ name }) => name === input.name)) group.push(input);
	}
	return [...sources].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}

async function writeSourceBundle(path, { application, sources, sourceInputsRoot, sourceRevision }) {
	const handle = await open(path, 'wx', 0o444);
	const hash = createHash('sha256');
	const pending = [];
	let byteLength = 0;
	const zip = new Zip((error, bytes) => {
		if (error) throw error;
		pending.push(bytes);
	});
	async function flush() {
		for (const bytes of pending.splice(0)) {
			byteLength += bytes.byteLength;
			if (byteLength > MAXIMUM_BUNDLE_BYTES) throw new Error('Release source bytes exceed the ZIP budget.');
			hash.update(bytes);
			await handle.writeFile(bytes);
		}
	}
	function entry(name) {
		const output = new ZipPassThrough(name);
		output.mtime = new Date(1980, 0, 1);
		zip.add(output);
		return output;
	}
	async function addArchive(name, source, expected) {
		const output = entry(name);
		const descriptor = await readAuthenticatedArchive(source, expected, async (bytes) => {
			output.push(bytes);
			await flush();
		});
		output.push(Buffer.alloc(0), true);
		await flush();
		return { path: name, ...descriptor };
	}
	try {
		const files = [await addArchive('application.zip', application)];
		for (const [name, [input, ...duplicates]] of sources) {
			files.push(await addArchive(name, resolve(sourceInputsRoot, input.name), input));
			for (const duplicate of duplicates) await readAuthenticatedArchive(resolve(sourceInputsRoot, duplicate.name), duplicate);
		}
		const manifest = { schemaVersion: 1, sourceRevision,
			purpose: 'application-and-authenticated-desktop-corresponding-source', files };
		entry('SOURCE_MANIFEST.json').push(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), true);
		entry('README.md').push(Buffer.from([
			'# Release sources', '', `Application source revision: ${sourceRevision}.`, '',
			'Extract application.zip for the complete committed repository, including native build recipes, patches, and license notices.',
			'Extract the ZIPs under bundled-codecs/ for the codec sources, authenticated upstream archives, and rebuild instructions.',
			'The sdk/ directory retains the exact authenticated upstream SDK source archives. Extract them when following the native build recipes.',
			'SOURCE_MANIFEST.json records the byte length and SHA-256 digest of every inner archive.', '',
		].join('\n')), true);
		zip.end();
		await flush();
		return { byteLength, sha256: hash.digest('hex') };
	} finally {
		zip.terminate();
		await handle.close();
	}
}

async function readAuthenticatedArchive(path, expected, consume) {
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1
		|| metadata.size > MAXIMUM_SOURCE_BYTES || (expected && metadata.size !== expected.byteLength)) {
		throw new Error('Release source input is not a regular file with the authenticated bytes.');
	}
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const hash = createHash('sha256');
		let byteLength = 0;
		for await (const bytes of handle.createReadStream({ autoClose: false })) {
			byteLength += bytes.byteLength;
			if (byteLength > metadata.size) throw new Error('Release source bytes grew during bundling.');
			hash.update(bytes);
			if (consume) await consume(bytes);
		}
		const sha256 = hash.digest('hex');
		if (byteLength !== metadata.size || (expected && sha256 !== expected.sha256)) {
			throw new Error('Release source input digest disagrees with its authenticated bytes.');
		}
		return { byteLength, sha256 };
	} finally {
		await handle.close();
	}
}
