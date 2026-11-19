/* SPDX-License-Identifier: AGPL-3.0-only */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fetchVerifiedDesktopBundledCodecSource } from './desktop-bundled-codec-corresponding-source.mjs';
import { FDK_AAC_VERSION, FDK_RUNTIME_DIR, readFdkAacIdentity, verifyFdkAacExecutable } from '../../desktop/fdk-aac-process.ts';

const run = promisify(execFile);
const SOURCE_SHA256 = '2dc6952b70283888994ae6e551a79039781f0a64c67fb637bffd5a8f483c34c5';
const SOURCE_URL = 'https://archive.ubuntu.com/ubuntu/pool/universe/f/fdk-aac-free/fdk-aac-free_2.0.3.orig.tar.gz';
const SOURCE_FILES = ['CMakeLists.txt', 'LICENSE', 'README.md', 'main.cpp', 'reject-sbr.cmake'];
const ARCHIVE = `fdk-aac-free-${FDK_AAC_VERSION}.tar.gz`;
const describe = (bytes) => ({ byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') });

export async function stageDesktopFdkAac({ repositoryRoot, runtimeRoot, desktopRoot, licenseRoot, target }) {
	const platform = { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform];
	if (target !== `${platform}-${process.arch}`) throw new Error('The bundled FDK AAC build requires a matching target-native runner.');
	const temporary = await mkdtemp(join(tmpdir(), 'desktop-fdk-build-'));
	try {
		const bytes = await fetchVerifiedDesktopBundledCodecSource({
			url: SOURCE_URL, fileName: ARCHIVE, sha256: SOURCE_SHA256, byteLength: 2_205_011,
		});
		const archive = join(temporary, ARCHIVE);
		await writeFile(archive, bytes);
		const source = join(temporary, `fdk-aac-${FDK_AAC_VERSION}`);
		const build = join(temporary, 'build');
		const frontend = join(repositoryRoot, 'native/fdk-aac-tool');
		const payload = join(runtimeRoot, FDK_RUNTIME_DIR);
		const licenses = join(licenseRoot, FDK_RUNTIME_DIR);
		await run('cmake', ['-E', 'tar', 'xf', archive], { cwd: temporary });
		await run('cmake', ['-S', frontend, '-B', build, `-DFDK_AAC_SOURCE=${source}`, '-DCMAKE_BUILD_TYPE=Release',
			...(platform === 'win' ? ['-A', process.arch === 'arm64' ? 'ARM64' : 'x64'] : []),
			...(platform === 'mac' ? ['-DCMAKE_OSX_ARCHITECTURES=arm64', '-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0'] : []),
		]);
		await run('cmake', ['--build', build, '--config', 'Release', '--parallel', '2'], { maxBuffer: 2 * 1024 * 1024 });
		await run('cmake', ['--install', build, '--config', 'Release', '--prefix', payload]);
		const executableName = platform === 'win' ? 'fdk-aac-tool.exe' : 'fdk-aac-tool';
		const executable = join(payload, executableName);
		if (platform === 'mac') await run('codesign', ['--force', '--sign', '-', executable]);
		await smoke(executable, temporary);
		const binary = describe(await readFile(executable));
		const manifest = Buffer.from(`${JSON.stringify({ version: FDK_AAC_VERSION, target, ...binary })}\n`);
		await writeFile(join(desktopRoot, 'fdk-aac-manifest.json'), manifest, { flag: 'wx' });
		await mkdir(licenses, { recursive: true });
		await copyFile(archive, join(licenses, ARCHIVE));
		await copyFile(join(source, 'NOTICE'), join(licenses, 'NOTICE'));
		for (const name of SOURCE_FILES) await copyFile(join(frontend, name), join(licenses, name));
		const shippedSources = {};
		for (const name of [ARCHIVE, 'NOTICE', ...SOURCE_FILES]) {
			shippedSources[name] = describe(await readFile(join(licenses, name)));
		}
		return { target, executableName, binary, manifest: describe(manifest), sources: shippedSources };
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

export async function assertDesktopFdkAacFiles({ receipt, runtimeRoot, manifestBytes, licenseRoot }) {
	const root = join(runtimeRoot, FDK_RUNTIME_DIR);
	if (!receipt) {
		const stat = await lstat(root).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
		if (stat) throw new Error('The desktop package contains an unmanaged FDK AAC executable.');
		return;
	}
	const manifest = describe(manifestBytes);
	if (manifest.sha256 !== receipt.manifest.sha256 || manifest.byteLength !== receipt.manifest.byteLength) {
		throw new Error('The packaged FDK AAC manifest changed.');
	}
	const identity = readFdkAacIdentity(manifestBytes, runtimeRoot, receipt.target);
	await verifyFdkAacExecutable(identity);
	if (identity.sha256 !== receipt.binary.sha256 || identity.byteLength !== receipt.binary.byteLength
		|| (await readdir(root)).join() !== receipt.executableName) throw new Error('The packaged FDK AAC payload changed.');
	const names = [ARCHIVE, 'NOTICE', ...SOURCE_FILES].sort();
	const licenses = join(licenseRoot, FDK_RUNTIME_DIR);
	if ((await readdir(licenses)).sort().join() !== names.join()) throw new Error('The packaged FDK AAC source set changed.');
	for (const name of names) {
		const actual = describe(await readFile(join(licenses, name)));
		const expected = receipt.sources[name];
		if (actual.sha256 !== expected.sha256 || actual.byteLength !== expected.byteLength) throw new Error('The packaged FDK AAC source changed.');
	}
}

async function smoke(executable, cwd) {
	const timeout = 10_000;
	await writeFile(join(cwd, 'canary.pcm'), Buffer.alloc(4096 * 2 * 4));
	const result = await run(executable, ['encode', '48000', '2', '160000', '32768', 'canary.pcm', 'canary.aac'], { cwd, timeout });
	if (result.stdout.trim() !== '2048') throw new Error('FDK AAC encoder priming canary failed.');
	await run(executable, ['decode', '48000', '2', '65536', 'canary.aac', 'decoded.pcm'], { cwd, timeout });
	const decoded = await readFile(join(cwd, 'decoded.pcm'));
	if (decoded.length !== (4096 + 2048) * 2 * 4 || !decoded.every(byte => byte === 0)) {
		throw new Error('FDK AAC decoder canary failed.');
	}
}
