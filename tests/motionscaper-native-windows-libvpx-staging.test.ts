/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';

import * as driver from '../native/framescaper-media-host/build/recipe-driver.mjs';
import { collectBoostHeaderClosure, collectExtractedSourceTree } from '../native/framescaper-media-host/build/source-authentication.mjs';
import { sourcePins } from './helpers/framescaper-native-host-build-fixture.mjs';

interface TreePin { readonly algorithm: string; readonly fileCount: number; readonly sha256: string; readonly roots?: readonly string[] }
interface SourcePin { readonly path: string; readonly byteLength: number; readonly sha256: string }
interface HostManifest {
	sourceFiles: SourcePin[];
	readonly sharedSourceFiles: readonly SourcePin[];
	readonly ffmpeg: { readonly sha256: string; extractedTree: TreePin };
	readonly boost: { readonly archiveSha256: string; headerClosure: TreePin };
}
interface ExternalManifest { readonly libraries: { readonly id: string; readonly version: string; readonly revision: string; readonly sha256: string; extractedTree: TreePin }[] }
interface StagingDriver { stageFramescaperMediaHostFfmpegSourceRoot: (expected: TreePin, source: string, destination: string) => void; stageFramescaperMediaHostExternalSourceRoot: (manifest: ExternalManifest, id: string, source: string, destination: string) => void }
const stage = (...args: Parameters<StagingDriver['stageFramescaperMediaHostExternalSourceRoot']>) => {
	const production = driver as unknown as StagingDriver;
	assert.equal(typeof production.stageFramescaperMediaHostExternalSourceRoot, 'function');
	production.stageFramescaperMediaHostExternalSourceRoot(...args);
};
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const writeJson = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, '\t')}\n`);
const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const treePin = (tree: TreePin): TreePin => ({ algorithm: tree.algorithm, fileCount: tree.fileCount, sha256: tree.sha256, ...(tree.roots ? { roots: tree.roots } : {}) });

function fixture(context: TestContext) {
	const root = mkdtempSync(join(tmpdir(), 'motionscaper-libvpx-staging-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const actual = resolve(import.meta.dirname, '..');
	const repositoryRoot = join(root, 'repository');
	const hostRoot = join(repositoryRoot, 'native/framescaper-media-host');
	cpSync(join(actual, 'native/framescaper-media-host'), hostRoot, { recursive: true });
	const manifestPath = join(hostRoot, 'source-manifest.json');
	const manifest = readJson<HostManifest>(manifestPath);
	for (const pin of manifest.sharedSourceFiles) {
		const destination = join(repositoryRoot, pin.path);
		mkdirSync(dirname(destination), { recursive: true });
		copyFileSync(join(actual, pin.path), destination);
	}
	const ffmpegSourceRoot = join(root, 'ffmpeg');
	mkdirSync(ffmpegSourceRoot);
	writeFileSync(join(ffmpegSourceRoot, 'configure'), '#!/bin/sh\n');
	writeFileSync(join(ffmpegSourceRoot, 'RELEASE'), '9.0.1\n');
	manifest.ffmpeg.extractedTree = treePin(collectExtractedSourceTree(ffmpegSourceRoot));
	writeJson(join(ffmpegSourceRoot, '.framescaper-source-identity.json'), {
		schemaVersion: 1, component: 'ffmpeg', version: '9.0.1', archiveSha256: manifest.ffmpeg.sha256,
		extractedTreeSha256: manifest.ffmpeg.extractedTree.sha256, root: ffmpegSourceRoot,
	});
	const externalSourceRoot = join(root, 'external');
	mkdirSync(externalSourceRoot);
	const externalPath = join(hostRoot, 'build/ffmpeg-9.0.1-external-sources.json');
	const external = readJson<ExternalManifest>(externalPath);
	for (const row of external.libraries) {
		const sourceRoot = join(externalSourceRoot, row.id);
		mkdirSync(sourceRoot);
		writeFileSync(join(sourceRoot, 'source.txt'), `${row.id}\n`);
		row.extractedTree = treePin(collectExtractedSourceTree(sourceRoot));
		writeJson(join(sourceRoot, '.framescaper-source-identity.json'), {
			schemaVersion: 1, component: row.id, version: row.version, revision: row.revision,
			archiveSha256: row.sha256, extractedTreeSha256: row.extractedTree.sha256, root: sourceRoot,
		});
	}
	writeJson(externalPath, external);
	const boostSourceRoot = join(root, 'boost');
	mkdirSync(join(boostSourceRoot, 'boost/multiprecision'), { recursive: true });
	writeFileSync(join(boostSourceRoot, 'boost/version.hpp'), '#define BOOST_VERSION 109200\n');
	writeFileSync(join(boostSourceRoot, 'boost/multiprecision/cpp_int.hpp'), '#pragma once\n');
	manifest.boost.headerClosure = treePin(collectBoostHeaderClosure(boostSourceRoot, ['boost/multiprecision/cpp_int.hpp']));
	writeJson(join(boostSourceRoot, '.framescaper-source-identity.json'), {
		schemaVersion: 1, component: 'boost', version: '1.92.0', archiveSha256: manifest.boost.archiveSha256,
		headerClosureSha256: manifest.boost.headerClosure.sha256, root: boostSourceRoot,
	});
	manifest.sourceFiles = sourcePins(hostRoot, manifest.sourceFiles.map(pin => pin.path));
	writeJson(manifestPath, manifest);
	const toolRoot = join(root, 'tools');
	mkdirSync(toolRoot);
	const executables = Object.fromEntries(['ar', 'c', 'cmake', 'cxx', 'make', 'msbuild', 'ninja', 'pkgConfig', 'ranlib', 'rc', 'shell'].map(role => {
		const path = join(toolRoot, `${role}.tool`);
		writeFileSync(path, `authenticated-${role}\n`);
		return [role, { path, sha256: sha256(readFileSync(path)) }];
	}));
	const body = { schemaVersion: 1, targetId: 'win-x64', hostRuntime: 'win32-x64', executables, environment: { PATH: toolRoot } };
	const identity = driver.fingerprintFramescaperMediaHostToolchainReceipt(body);
	const toolchainReceipt = join(root, 'toolchain.json');
	writeJson(toolchainReceipt, { ...body, identitySha256: identity });
	const outputRoot = join(root, 'output');
	mkdirSync(outputRoot);
	return { root, external, ffmpegOriginal: ffmpegSourceRoot, ffmpegTree: manifest.ffmpeg.extractedTree, original: join(externalSourceRoot, 'libvpx'), outputRoot, options: {
		repositoryRoot, targetId: 'win-x64', hostRuntime: 'win32-x64', toolchainReceipt,
		toolchainIdentity: identity, ffmpegSourceRoot, boostSourceRoot, externalSourceRoot, outputRoot,
	} };
}

test('Motion libvpx source staging authenticates its copied closure and preserves the original receipt', context => {
	const input = fixture(context);
	const before = treePin(collectExtractedSourceTree(input.original));
	const receipt = readFileSync(join(input.original, '.framescaper-source-identity.json'));
	const destination = join(input.root, 'staged');
	stage(input.external, 'libvpx', input.original, destination);
	assert.deepEqual(treePin(collectExtractedSourceTree(destination)), before);
	assert.deepEqual(treePin(collectExtractedSourceTree(input.original)), before);
	assert.deepEqual(readFileSync(join(destination, '.framescaper-source-identity.json')), receipt);
});

test('Motion libvpx staging rejects a contaminated copy and an altered original source', context => {
	const input = fixture(context);
	const destination = join(input.root, 'contaminated');
	mkdirSync(destination);
	writeFileSync(join(destination, 'forged.c'), 'int forged;\n');
	assert.throws(() => stage(input.external, 'libvpx', input.original, destination), /provisioned libvpx source tree drifted from its pin/iu);
	const existing = join(input.root, 'existing');
	mkdirSync(existing);
	writeFileSync(join(existing, 'source.txt'), 'existing sentinel\n');
	assert.throws(() => stage(input.external, 'libvpx', input.original, existing));
	assert.equal(readFileSync(join(existing, 'source.txt'), 'utf8'), 'existing sentinel\n');
	writeFileSync(join(input.original, 'source.txt'), 'tampered\n');
	const refused = join(input.root, 'refused');
	assert.throws(() => stage(input.external, 'libvpx', input.original, refused), /provisioned libvpx source tree drifted from its pin/iu);
	assert.equal(existsSync(refused), false, 'source authentication must happen before copying');
});

test('Motion Windows recipe owns and authenticates staged libvpx before its first command', context => {
	if (process.platform !== 'win32' || process.arch !== 'x64') return context.skip('Windows x64 native execution fixture');
	const input = fixture(context);
	const before = treePin(collectExtractedSourceTree(input.original));
	const recipe = driver.createFramescaperMediaHostBuildRecipe(input.options);
	let calls = 0;
	driver.executeFramescaperMediaHostBuildRecipe(recipe, {
		run: () => {
			assert.deepEqual(treePin(collectExtractedSourceTree(join(input.outputRoot, 'libvpx-build', 'src'))), before);
			assert.deepEqual(treePin(collectExtractedSourceTree(join(input.outputRoot, 'ffmpeg-build', 'src'))), input.ffmpegTree);
			calls += 1;
			return { status: 0 };
		}, verifyFfmpegConfiguration: () => ({}),
	});
	assert.ok(calls > 0);
	assert.deepEqual(treePin(collectExtractedSourceTree(input.original)), before);
});

test('Motion Windows refuses libvpx source drift before staging or any runner command', context => {
	if (process.platform !== 'win32' || process.arch !== 'x64') return context.skip('Windows x64 native execution fixture');
	const input = fixture(context);
	const recipe = driver.createFramescaperMediaHostBuildRecipe(input.options);
	writeFileSync(join(input.original, 'source.txt'), 'tampered after admission\n');
	let calls = 0;
	assert.throws(() => driver.executeFramescaperMediaHostBuildRecipe(recipe, {
		run: () => { calls += 1; return { status: 0 }; }, verifyFfmpegConfiguration: () => ({}),
	}), /pinned content closure/iu);
	assert.equal(calls, 0);
	assert.equal(existsSync(join(input.outputRoot, 'libvpx-build', 'src')), false);
});

const stageFfmpeg = (...args: Parameters<StagingDriver['stageFramescaperMediaHostFfmpegSourceRoot']>) => {
	const production = driver as unknown as StagingDriver;
	assert.equal(typeof production.stageFramescaperMediaHostFfmpegSourceRoot, 'function');
	production.stageFramescaperMediaHostFfmpegSourceRoot(...args);
};

test('Motion FFmpeg copy authenticates its same pinned tree and preserves raw receipt bytes', context => {
	const input = fixture(context);
	const receipt = readFileSync(join(input.ffmpegOriginal, '.framescaper-source-identity.json'));
	const destination = join(input.root, 'ffmpeg-copy');
	stageFfmpeg(input.ffmpegTree, input.ffmpegOriginal, destination);
	assert.deepEqual(treePin(collectExtractedSourceTree(destination)), input.ffmpegTree);
	assert.deepEqual(treePin(collectExtractedSourceTree(input.ffmpegOriginal)), input.ffmpegTree);
	assert.deepEqual(readFileSync(join(destination, '.framescaper-source-identity.json')), receipt);
	assert.deepEqual(readFileSync(join(input.ffmpegOriginal, '.framescaper-source-identity.json')), receipt);
	const contaminated = join(input.root, 'contaminated-ffmpeg');
	mkdirSync(contaminated);
	writeFileSync(join(contaminated, 'forged.c'), 'forged\n');
	assert.throws(() => stageFfmpeg(input.ffmpegTree, input.ffmpegOriginal, contaminated));
	assert.equal(readFileSync(join(contaminated, 'forged.c'), 'utf8'), 'forged\n');
	writeFileSync(join(input.ffmpegOriginal, 'RELEASE'), 'tampered\n');
	const refused = join(input.root, 'refused-ffmpeg');
	assert.throws(() => stageFfmpeg(input.ffmpegTree, input.ffmpegOriginal, refused));
	assert.equal(existsSync(refused), false);
});

test('Motion Windows refuses FFmpeg raw drift before copy or any runner command', context => {
	if (process.platform !== 'win32' || process.arch !== 'x64') return context.skip('Windows x64 native execution fixture');
	const input = fixture(context);
	const recipe = driver.createFramescaperMediaHostBuildRecipe(input.options);
	writeFileSync(join(input.ffmpegOriginal, 'RELEASE'), 'tampered after admission\n');
	let calls = 0;
	assert.throws(() => driver.executeFramescaperMediaHostBuildRecipe(recipe, {
		run: () => { calls += 1; return { status: 0 }; }, verifyFfmpegConfiguration: () => ({}),
	}));
	assert.equal(calls, 0);
	assert.equal(existsSync(join(input.outputRoot, 'ffmpeg-build', 'src')), false);
});

test('Motion Windows driver normalizes the installed x265 archive for its pkg-config link name', context => {
	if (process.platform !== 'win32' || process.arch !== 'x64') return context.skip('Windows x64 native execution fixture');
	const input = fixture(context);
	const recipe = driver.createFramescaperMediaHostBuildRecipe(input.options);
	const install = join(input.outputRoot, 'x265-install');
	const archive = join(install, 'lib', 'x265-static.lib');
	const metadata = join(install, 'lib', 'pkgconfig', 'x265.pc');
	const template = join(input.options.repositoryRoot, 'native/framescaper-media-host/build/windows-x265.pc');
	const archiveBytes = Buffer.from('installed MSVC x265 static archive fixture\n');
	let verified = false;
	driver.executeFramescaperMediaHostBuildRecipe(recipe, {
		run: (executable: string, args: string[]) => {
			if (args[0] === '--install' && args[1] === join(input.outputRoot, 'x265-build')) {
				mkdirSync(dirname(metadata), { recursive: true });
				writeFileSync(archive, archiveBytes);
				writeFileSync(metadata, 'Version: 4.2\nLibs: -L${libdir} -lx265\nLibs.private:\n');
			}
			if (args[0] === '-E' && args[1] === 'copy' && (args[2] === archive || args[2] === template)) {
				assert.equal(executable, join(input.root, 'tools', 'cmake.tool'));
				copyFileSync(args[2], args[3]);
			}
			if (args[0] === './src/configure') {
				assert.ok(args.includes('--pkg-config-flags=--static'));
				assert.ok(!args.some(argument => argument.startsWith('--extra-libs=')));
				assert.match(readFileSync(metadata, 'utf8'), /^Libs\.private: -ladvapi32$/mu);
				assert.deepEqual(readFileSync(metadata), readFileSync(template));
				const name = / -l(\w+)/u.exec(readFileSync(metadata, 'utf8'))?.[1];
				assert.equal(name, 'x265');
				assert.deepEqual(readFileSync(join(install, 'lib', `${name}.lib`)), archiveBytes);
				assert.deepEqual(readFileSync(archive), archiveBytes);
				verified = true;
			}
			return { status: 0 };
		}, verifyFfmpegConfiguration: () => ({}),
	});
	assert.equal(verified, true, 'FFmpeg must consume the installed pkg-config library name');
});
