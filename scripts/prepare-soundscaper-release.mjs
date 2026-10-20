#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { constants } from 'node:fs';
import { copyFile, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	expectedProductReleaseTag,
	resolveProductApplicationVersion,
	resolveProductDesktopMetadata,
	resolveProductReleaseTag,
	validateProductReleaseLines,
} from './lib/product-release-lines.mjs';

const DEFAULT_REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const STABLE_SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const DOCUMENT_PATHS = Object.freeze({
	releaseLines: 'config/product-release-lines.json',
	packageMetadata: 'package.json',
	packageLock: 'package-lock.json',
	desktopProduct: 'desktop/product.json',
});
const REPLACEMENT_ORDER = Object.freeze([
	'packageMetadata', 'packageLock', 'desktopProduct', 'releaseLines',
]);

export function parseSoundscaperReleasePrepareArguments(args) {
	if (Array.isArray(args) && args.length === 0) return Object.freeze({});
	if (Array.isArray(args) && args.length === 1 && args[0] === '--check') {
		return Object.freeze({ checkOnly: true });
	}
	if (!Array.isArray(args) || args.length !== 1 || typeof args[0] !== 'string'
		|| args[0].startsWith('-')) {
		throw new TypeError('Release preparation accepts one version, no arguments to synchronize, or --check.');
	}
	return Object.freeze({ version: args[0] });
}

export function createSoundscaperReleasePreparation(documents, versionValue) {
	const releaseLines = structuredClone(readReleaseLines(documents));
	assertPackageDocuments(documents.packageMetadata, documents.packageLock);
	if (versionValue !== undefined) {
		if (typeof versionValue !== 'string') throw new TypeError('The Soundscaper version must be a string.');
		const channel = STABLE_SEMVER.test(versionValue) ? 'stable' : 'candidate';
		releaseLines.products.soundscaper[channel].version = versionValue;
		releaseLines.products.soundscaper.applicationVersionChannel = channel;
		releaseLines.products.soundscaper.releaseChannel = channel;
	}
	const validatedReleaseLines = validateProductReleaseLines(releaseLines);
	const version = resolveProductApplicationVersion('soundscaper', validatedReleaseLines);
	const packageMetadata = structuredClone(documents.packageMetadata);
	const packageLock = structuredClone(documents.packageLock);
	packageMetadata.version = version;
	packageLock.version = version;
	packageLock.packages[''].version = version;
	return Object.freeze({
		releaseLines: structuredClone(validatedReleaseLines),
		packageMetadata,
		packageLock,
		desktopProduct: structuredClone(resolveProductDesktopMetadata(
			'soundscaper', validatedReleaseLines,
		)),
	});
}

export function assertSoundscaperReleaseMetadataSynchronized(documents, tagValue) {
	const { releaseLines, version } = assertSynchronizedSoundscaperMetadata(documents);
	const release = resolveProductReleaseTag(tagValue, releaseLines);
	if (release.productId !== 'soundscaper' || release.channel !== 'stable'
		|| release.version !== version) {
		throw new Error('The tag does not match the selected Soundscaper stable release line.');
	}
	return release;
}

export async function verifyCheckedInSoundscaperRelease(options = {}) {
	const repositoryRoot = resolve(options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT);
	const documents = await readDocuments(repositoryRoot);
	return assertSoundscaperReleaseMetadataSynchronized(documents, options.tag);
}

export async function prepareSoundscaperRelease(options = {}) {
	const repositoryRoot = resolve(options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT);
	const documents = await readDocuments(repositoryRoot);
	if (options.checkOnly && options.version !== undefined) {
		throw new TypeError('A release metadata check cannot also prepare a version.');
	}
	const prepared = options.checkOnly ? documents : createSoundscaperReleasePreparation(documents, options.version);
	if (options.checkOnly) assertSynchronizedSoundscaperMetadata(prepared);
	else await replaceDocuments(repositoryRoot, prepared);
	const version = resolveProductApplicationVersion('soundscaper', prepared.releaseLines);
	const tag = expectedProductReleaseTag('soundscaper', prepared.releaseLines);
	(options.writeOutput ?? ((value) => process.stdout.write(value)))(
		options.checkOnly ? `Soundscaper ${version} metadata is synchronized (${tag}).\n`
			: `Soundscaper ${version} metadata prepared; commit it before pushing ${tag}.\n`,
	);
	return prepared;
}

async function readDocuments(repositoryRoot) {
	const entries = await Promise.all(Object.entries(DOCUMENT_PATHS).map(async ([name, path]) => [
		name, JSON.parse(await readFile(resolve(repositoryRoot, path), 'utf8')),
	]));
	return Object.fromEntries(entries);
}

async function replaceDocuments(repositoryRoot, documents) {
	const token = `${process.pid}-${Date.now()}`;
	const entries = REPLACEMENT_ORDER.map((name) => {
		const target = resolve(repositoryRoot, DOCUMENT_PATHS[name]);
		return { name, target, temporary: `${target}.release-stage-${token}`,
			backup: `${target}.release-backup-${token}` };
	});
	let published = 0;
	try {
		for (const entry of entries) {
			await writeFile(entry.temporary, `${JSON.stringify(documents[entry.name], null, '\t')}\n`,
				{ encoding: 'utf8', flag: 'wx', mode: 0o600 });
			await copyFile(entry.target, entry.backup, constants.COPYFILE_EXCL);
		}
		for (const entry of entries) {
			await rename(entry.temporary, entry.target);
			published += 1;
		}
	} catch (error) {
		for (const entry of entries.slice(0, published).reverse()) {
			await copyFile(entry.backup, entry.target);
		}
		throw error;
	} finally {
		for (const entry of entries) {
			await ignoreMissing(unlink(entry.temporary));
			await ignoreMissing(unlink(entry.backup));
		}
	}
}

function assertPackageDocuments(packageMetadata, packageLock, expectedVersion) {
	if (!packageMetadata || typeof packageMetadata !== 'object' || Array.isArray(packageMetadata)
		|| packageMetadata.name !== 'soundscaper'
		|| !packageLock || typeof packageLock !== 'object' || Array.isArray(packageLock)
		|| packageLock.name !== 'soundscaper'
		|| !packageLock.packages || typeof packageLock.packages !== 'object'
		|| packageLock.packages['']?.name !== 'soundscaper'
		|| (expectedVersion !== undefined && [packageMetadata.version, packageLock.version,
			packageLock.packages[''].version].some(version => version !== expectedVersion))) {
		throw new Error('package.json and package-lock.json are not synchronized to Soundscaper.');
	}
}

function readReleaseLines(documents) {
	if (!documents || typeof documents !== 'object' || Array.isArray(documents)) {
		throw new TypeError('Soundscaper release preparation documents are invalid.');
	}
	return validateProductReleaseLines(documents.releaseLines);
}

function assertSynchronizedSoundscaperMetadata(documents) {
	const releaseLines = readReleaseLines(documents);
	const version = resolveProductApplicationVersion('soundscaper', releaseLines);
	assertPackageDocuments(documents.packageMetadata, documents.packageLock, version);
	const expectedDesktop = resolveProductDesktopMetadata('soundscaper', releaseLines);
	if (JSON.stringify(documents.desktopProduct) !== JSON.stringify(expectedDesktop)) {
		throw new Error('The checked-in Soundscaper desktop metadata is not synchronized.');
	}
	return Object.freeze({ releaseLines, version });
}

async function ignoreMissing(operation) {
	try { await operation; }
	catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

function isMain() {
	return Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
	const options = parseSoundscaperReleasePrepareArguments(process.argv.slice(2));
	prepareSoundscaperRelease(options).catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
