/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { collectExtractedSourceTree } from '../../native/framescaper-media-host/build/source-authentication.mjs';
import { downloadCiBytes } from './ci-download-retry.mjs';
import { materializeMilestone5SourceArchive } from './milestone-5-source-archive-extraction.mjs';

const root = realpathSync(resolve(import.meta.dirname, '../..'));
const pins = JSON.parse(readFileSync(resolve(root, 'config/soundscaper-tracktion-sources.json'), 'utf8'));
const repositoryCache = resolve(root, '.native-build');
const archiveDirectory = resolve(repositoryCache, 'tracktion-source-archives');
const sourceDirectory = resolve(repositoryCache, 'tracktion-pinned-sources');

export async function provisionTracktionSources() {
	mkdirSync(archiveDirectory, { recursive: true });
	mkdirSync(sourceDirectory, { recursive: true });
	const [tracktion, juce] = await Promise.all([provision('tracktion'), provision('juce')]);
	return { tracktion, juce };
}

async function provision(id) {
	const pin = pins[id];
	const archiveName = `${id}.tar.gz`;
	const archivePath = resolve(archiveDirectory, archiveName);
	const destinationRoot = resolve(sourceDirectory, id);
	if (!existsSync(destinationRoot)) {
		const cached = existsSync(archivePath);
		if (cached && statSync(archivePath).size !== pin.archive.byteLength) {
			throw new Error(`${archivePath} has an incorrect byte length.`);
		}
		const bytes = cached ? readFileSync(archivePath) : await downloadCiBytes(pin.archive.url, {
			maximumBytes: pin.archive.byteLength,
			timeoutMs: 120_000,
		});
		if (bytes.byteLength !== pin.archive.byteLength || createHash('sha256').update(bytes).digest('hex') !== pin.archive.sha256) {
			throw new Error(`${archivePath} does not match its source archive pin.`);
		}
		await materializeMilestone5SourceArchive({
			archiveBytes: bytes, archiveName, destinationRoot, expectedTree: pin.tree,
		});
		if (!cached) writeFileSync(archivePath, bytes, { flag: 'wx' });
	}
	const tree = collectExtractedSourceTree(destinationRoot);
	if (tree.algorithm !== pin.tree.algorithm || tree.fileCount !== pin.tree.fileCount || tree.sha256 !== pin.tree.sha256) {
		throw new Error(`${destinationRoot} does not match the extracted source pin.`);
	}
	return destinationRoot;
}
