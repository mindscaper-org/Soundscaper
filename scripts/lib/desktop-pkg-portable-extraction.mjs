/* SPDX-License-Identifier: AGPL-3.0-only */

/** Inspect fixed XAR components and unpack only the app's legacy gzip/CPIO payload. */

import { lstat, readdir, realpath, rename } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';

const TOOL_OPTIONS = Object.freeze({ encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 5 * 60_000 });
const MAXIMUM_FILES = 100_000;
const MAXIMUM_FILE_BYTES = 8 * 1024 ** 3;
const MAXIMUM_TOTAL_BYTES = 32 * 1024 ** 3;

export async function expandPkgWithSevenZip({ artifact, extractedRoot, productId, sevenZip }, execute) {
	if (typeof sevenZip !== 'string' || sevenZip.length === 0) throw new Error('Portable PKG extraction requires 7-Zip.');
	const app = `org.${productId}.desktop.pkg`;
	const optional = `org.${productId}.desktop.ffmpeg.pkg`;
	const inventory = records(await execute(sevenZip, ['l', '-tXar', '-slt', '-bd', '-spd', artifact], TOOL_OPTIONS), 'Xar');
	const allowedFiles = new Set(['Distribution', `${app}/PackageInfo`, `${app}/Payload`, `${app}/Bom`,
		`${optional}/PackageInfo`, `${optional}/Scripts`, `${optional}/Bom`]);
	const selected = [];
	for (const [path, properties] of inventory) {
		if (path === '[TOC].xml') continue; // 7-Zip's synthesized view of the XAR header.
		if ((path === app || path === optional) && properties.get('Mode')?.startsWith('d')) continue;
		if (!allowedFiles.has(path) || !properties.get('Mode')?.startsWith('-')) {
			throw new Error(`The PKG XAR contains an unexpected component or payload: ${path}.`);
		}
		selected.push(path);
	}
	for (const required of ['Distribution', `${app}/PackageInfo`, `${app}/Payload`,
		`${optional}/PackageInfo`, `${optional}/Scripts`]) {
		if (!selected.includes(required)) throw new Error(`The PKG XAR is missing ${required}.`);
	}
	// Explicit archive type prevents 7-Zip from silently opening the nested Payload.
	await execute(sevenZip, ['x', '-tXar', '-y', '-bd', '-spd', `-o${extractedRoot}`, artifact, ...selected], TOOL_OPTIONS);
	const payload = join(extractedRoot, app, 'Payload');
	await canonicalFile(payload);
	const compressed = join(extractedRoot, '.application-payload.gz');
	await rename(payload, compressed);
	const cpioRoot = join(extractedRoot, '.application-cpio');
	await execute(sevenZip, ['e', '-tgzip', '-y', '-bd', '-spd', `-o${cpioRoot}`, compressed], TOOL_OPTIONS);
	const gzipFiles = await readdir(cpioRoot, { withFileTypes: true });
	if (gzipFiles.length !== 1 || !gzipFiles[0].isFile() || gzipFiles[0].isSymbolicLink()) {
		throw new Error('The PKG gzip stream must expand into one regular CPIO archive.');
	}
	const cpio = join(cpioRoot, gzipFiles[0].name);
	await canonicalFile(cpio);
	const applicationName = productId === 'soundscaper' ? 'Soundscaper.app' : 'Framescaper.app';
	const entries = records(await execute(sevenZip, ['l', '-tCpio', '-slt', '-bd', '-spd', cpio], TOOL_OPTIONS), 'Cpio');
	for (const [name, properties] of entries) {
		const mode = properties.get('Mode') ?? '';
		const withoutPrefix = name.replace(/^(?:\.\/)+/u, '');
		const path = mode.startsWith('d') ? withoutPrefix.replace(/\/$/u, '') : withoutPrefix;
		if ((path === '.' || path === '') && mode.startsWith('d')) continue;
		if (path.includes('\\') || path.includes('\0') || posix.normalize(path) !== path
			|| (path !== applicationName && !path.startsWith(`${applicationName}/`)) || !/^[dl-]/u.test(mode)) {
			throw new Error(`The PKG CPIO contains a path outside its application: ${name}.`);
		}
		const hardLink = properties.get('Hard Link') ?? '';
		if (hardLink !== '') {
			const target = hardLink.replace(/^(?:\.\/)+/u, '');
			if (target.includes('\\') || target.includes('\0') || posix.normalize(target) !== target
				|| (target !== applicationName && !target.startsWith(`${applicationName}/`))) {
				throw new Error(`The PKG CPIO contains a hard link outside its application: ${name}.`);
			}
		}
		if (mode.startsWith('l')) {
			const target = properties.get('Symbolic Link') ?? '';
			const destination = posix.normalize(posix.join(posix.dirname(path), target));
			if (target === '' || target.includes('\\') || target.includes('\0') || posix.isAbsolute(target)
				|| (destination !== applicationName && !destination.startsWith(`${applicationName}/`))) {
				throw new Error(`The PKG CPIO contains a symbolic link outside its application: ${name}.`);
			}
		}
	}
	await execute(sevenZip, ['x', '-tCpio', '-y', '-bd', '-spd', `-o${payload}`, cpio], TOOL_OPTIONS);
}

function records(result, type) {
	if (result.stderr !== '' || typeof result.stdout !== 'string') throw new Error('The PKG archive inspection produced unexpected diagnostics.');
	const output = result.stdout.replaceAll('\r\n', '\n');
	const separator = '\n----------\n';
	const offset = output.indexOf(separator);
	if (offset < 0 || output.lastIndexOf(separator) !== offset
		|| !output.slice(0, offset).split('\n').includes(`Type = ${type}`)) {
		throw new Error(`The PKG archive does not contain the expected ${type} structure.`);
	}
	const inventory = new Map();
	let totalBytes = 0;
	for (const block of output.slice(offset + separator.length).replace(/\n+$/u, '').split(/\n\n+/u)) {
		const properties = new Map();
		for (const line of block.split('\n')) {
			const divider = line.indexOf(' = ');
			const key = line.slice(0, divider);
			if (divider < 1 || properties.has(key)) throw new Error('The PKG archive listing has ambiguous properties.');
			properties.set(key, line.slice(divider + 3));
		}
		const path = properties.get('Path');
		const size = Number(properties.get('Size') ?? 0);
		if (typeof path !== 'string' || inventory.has(path) || inventory.size >= MAXIMUM_FILES
			|| !Number.isSafeInteger(size) || size < 0 || size > MAXIMUM_FILE_BYTES) {
			throw new Error('The PKG archive listing has duplicate or over-bound entries.');
		}
		totalBytes += size;
		if (totalBytes > MAXIMUM_TOTAL_BYTES) throw new Error('The PKG archive exceeds its installed byte limit.');
		inventory.set(path, properties);
	}
	return inventory;
}

async function canonicalFile(path) {
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > MAXIMUM_FILE_BYTES
		|| await realpath(path) !== resolve(path) || await realpath(dirname(path)) !== resolve(dirname(path))) {
		throw new Error('The PKG payload must be one canonical, bounded regular file.');
	}
}
