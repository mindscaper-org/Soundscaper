/* SPDX-License-Identifier: AGPL-3.0-only */

/** Expand a macOS product archive without running any package installation script. */

import { execFile } from 'node:child_process';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expandPkgWithSevenZip } from './desktop-pkg-portable-extraction.mjs';

const executeNative = promisify(execFile);
/**
 * @param {string} file
 * @param {readonly string[]} args
 * @param {import('node:child_process').ExecFileOptions} options
 */
const executeFile = async (file, args, options) => executeNative(file, args, { ...options, encoding: 'utf8' });

export async function extractPkgApplication({
	artifact, extractedRoot, productId, targetId, sevenZip = '',
}, { execute = executeFile, platform = process.platform } = {}) {
	const productName = productId === 'soundscaper' ? 'Soundscaper'
		: productId === 'framescaper' ? 'Framescaper' : null;
	if (targetId !== 'mac-arm64' || productName === null
		|| !basename(artifact).startsWith(`${productName}-`)
		|| !basename(artifact).endsWith('-mac-arm64.pkg')) {
		throw new Error('The PKG artifact does not bind its product and target.');
	}
	try {
		if (platform === 'darwin') {
			await execute('pkgutil', ['--expand-full', artifact, extractedRoot], {
				encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 5 * 60_000,
			});
		} else {
			await expandPkgWithSevenZip({ artifact, extractedRoot, productId, sevenZip }, execute);
		}
	} catch (error) {
		throw new Error('PKG expansion failed without package-content authority.', { cause: error });
	}
	const root = await regularDirectory(extractedRoot);
	const componentName = `org.${productId}.desktop.pkg`;
	const expectedComponents = [componentName, `org.${productId}.desktop.ffmpeg.pkg`].sort();
	const components = (await readdir(root)).filter(name => name.endsWith('.pkg')).sort();
	if (JSON.stringify(components) !== JSON.stringify(expectedComponents)) {
		throw new Error('The PKG must contain exactly its application and optional FFmpeg components.');
	}
	const component = await regularDirectory(join(root, componentName));
	const optional = await regularDirectory(join(root, `org.${productId}.desktop.ffmpeg.pkg`));
	const optionalPayload = join(optional, 'Payload');
	const optionalPayloadInfo = await lstat(optionalPayload).catch(error => {
		if (error.code === 'ENOENT') return null;
		throw error;
	});
	if (optionalPayloadInfo !== null && (!optionalPayloadInfo.isDirectory()
		|| optionalPayloadInfo.isSymbolicLink() || (await readdir(optionalPayload)).length !== 0)) {
		throw new Error('The optional FFmpeg PKG component must not carry an installed payload.');
	}
	const infoPath = join(component, 'PackageInfo');
	const info = await lstat(infoPath);
	if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) {
		throw new Error('The PKG application component metadata is invalid.');
	}
	const metadata = await readFile(infoPath, 'utf8');
	const packageTag = /<pkg-info\s[^>]*>/u.exec(metadata)?.[0] ?? '';
	if (!packageTag.includes(`identifier="org.${productId}.desktop"`)
		|| !packageTag.includes('install-location="/Applications"')) {
		throw new Error('The PKG application must install its product identity into /Applications.');
	}
	const payload = await regularDirectory(join(component, 'Payload'));
	const entries = await readdir(payload, { withFileTypes: true });
	if (entries.length !== 1 || entries[0].name !== `${productName}.app`
		|| !entries[0].isDirectory() || entries[0].isSymbolicLink()) {
		throw new Error('The PKG application payload must contain exactly its product app.');
	}
	return payload;
}

async function regularDirectory(path) {
	const metadata = await lstat(path);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== resolve(path)) {
		throw new Error('The PKG extraction must contain canonical regular directories.');
	}
	return path;
}
