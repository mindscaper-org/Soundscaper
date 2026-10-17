#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { rawDngFixtureV1 } from '../tests/helpers/lightscaper-raw-dng-current-fixture.ts';
import { pngChunk } from '../tests/helpers/image-metadata-fixtures.ts';
import { bundledSiteCopyForLocale } from '../src/common/i18n/site-copy.js';
import { withProjectFileExtension } from '../src/common/project-file-extensions.ts';
import type { LightscaperManagedSmokePlanCurrentV1, LightscaperSmokeCustodyCurrentV1, LightscaperSmokeFileCurrentV1,
	LightscaperSmokeRendererReportCurrentV1 } from '../desktop/lightscaper-managed-smoke-contract-current-v1.ts';
import { lightscaperSmokeStableJsonCurrentV1 } from '../desktop/lightscaper-managed-smoke-contract-current-v1.ts';
import { expectedLightscaperSmokeRawPixelsCurrentV1, lightscaperSmokeHashCurrentV1 as hash,
	verifyLightscaperSmokeArchiveCurrentV1, verifyLightscaperSmokePngCurrentV1 } from './lib/lightscaper-desktop-managed-smoke-verification-current-v1.ts';

import { launchLightscaperManagedSmokeProcessCurrentV1 } from './lib/lightscaper-desktop-managed-smoke-process-current-v1.ts';
import { readLightscaperManagedSmokeOptionsCurrentV1 } from './lib/lightscaper-desktop-managed-smoke-options-current-v1.ts';
import { admitLightscaperWindowsJobHelperCurrentV1, launchLightscaperWindowsJobProcessCurrentV1 } from './lib/lightscaper-windows-job-driver-current-v1.ts';

interface NativeDownload { readonly path: string; readonly suggestedName: string; readonly byteLength: number; readonly sha256: string; readonly state: string }
interface StageReceipt { readonly schemaVersion: number; readonly nonce: string; readonly stage: number; readonly processId: number;
	readonly renderer: LightscaperSmokeRendererReportCurrentV1; readonly downloads: readonly NativeDownload[];
	readonly security: Readonly<Record<string, unknown>>; readonly blockedNetworkRequests: readonly string[];
	readonly rawRuntimeRequests: readonly string[];
	readonly observedDownloads: readonly Readonly<{ currentContents: boolean; currentFrame: boolean; initiatorOrigin: string }>[] }

/** Run under Xvfb on a Linux runner with no display. This command executes a
 * real packaged binary three times; it never starts a development web server. */
export async function runLightscaperDesktopManagedSmokeCurrentV1(args: readonly string[]): Promise<string> {
	const options = readLightscaperManagedSmokeOptionsCurrentV1(args);
	// Authenticate the explicit current-host helper and app before any profile exists.
	const windowsJob = process.platform === 'win32' ? await admitLightscaperWindowsJobHelperCurrentV1({
		helperPath: options.windowsJobHelper ?? '', helperSha256: options.windowsJobHelperSha256 ?? '', executable: options.executable,
	}) : null;
	const executable = windowsJob?.executable ?? await realpath(options.executable), runtimeRoot = await realpath(options.runtimeRoot);
	if (!(await lstat(executable)).isFile()) throw new Error('Managed smoke executable is not a real file.');
	await mkdir(options.outputRoot, { recursive: true });
	const outputRoot = await realpath(options.outputRoot), nonce = randomBytes(16).toString('hex');
	const root = await mkdtemp(join(outputRoot, 'lightscaper-managed-')), profile = join(root, 'profile');
	let expectedPixelsForCleanup: Uint8Array<ArrayBuffer> | undefined;
	const stages: unknown[] = []; let preceding: LightscaperSmokeCustodyCurrentV1 | null = null;
	let archive: LightscaperSmokeFileCurrentV1 | null = null, archivePath: string | null = null, allJoined = true, complete = false;
	const qualificationPath = join(root, 'qualification.json');
	try {
		await mkdir(profile, { mode: 0o700 });
		const png = ownedRaster(), dng = rawDngFixtureV1().bytes;
		const fixtures = [file('Owned raster.png', 'image/png', png), file('Owned Bayer.dng', 'image/x-adobe-dng', dng)];
		const expectedPixels = await expectedLightscaperSmokeRawPixelsCurrentV1(runtimeRoot, new Uint8Array(dng));
		expectedPixelsForCleanup = expectedPixels;
		for (const stage of [1, 2, 3] as const) {
			const metadata = await lstat(profile);
			if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(profile) !== profile) throw new Error('Smoke profile is not its owned canonical private directory.');
			const backupSuggestedName = withProjectFileExtension(bundledSiteCopyForLocale('en').workspacePhoto, '.liscape');
			const plan: LightscaperManagedSmokePlanCurrentV1 = { schemaVersion: 1, nonce, stage, profilePath: profile,
				renderer: { nonce, stage, locale: 'en', fixtures, archive: stage === 2 ? archive : null,
					expectedFingerprint: preceding?.fingerprint ?? null, expectedNamespace: stage === 3 ? preceding?.namespace ?? null : null,
					expectedPhotoIds: preceding?.photos.map(photo => (photo.document as { id: string }).id) ?? null,
					backupSuggestedName } };
			const planPath = join(root, `${nonce}.stage-${stage}.json`);
			await writeFile(planPath, `${JSON.stringify(plan)}\n`, { flag: 'wx', mode: 0o600 });
			const launchArgs = [`--user-data-dir=${profile}`, '--lang=en', `--lightscaper-managed-smoke-plan=${planPath}`,
				`--lightscaper-managed-smoke-nonce=${nonce}`, ...(options.allowNoSandbox ? ['--no-sandbox'] : []),
				...(stage === 2 && archivePath ? [archivePath] : [])];
			allJoined = false;
			const processReceipt = windowsJob ? await launchLightscaperWindowsJobProcessCurrentV1(windowsJob, launchArgs, {
				nonce, stage, receiptPath: join(root, `${nonce}.stage-${stage}.windows-job.json`),
			}) : await launchLightscaperManagedSmokeProcessCurrentV1(executable, launchArgs);
			allJoined = processReceipt.readersRetired;
			await writeFile(join(root, `stage-${stage}.process.json`), `${JSON.stringify(processReceipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
			if (!allJoined || processReceipt.expired || processReceipt.launchError || processReceipt.exitCode !== 0 || processReceipt.forcedGroupRetirement) throw new Error(`Managed desktop process failed after owned-group retirement: ${JSON.stringify(processReceipt)}`);
			const receipt = JSON.parse((await boundedRead(join(root, `${nonce}.stage-${stage}.result.json`), 1024 * 1024)).toString('utf8')) as StageReceipt;
			if (receipt.schemaVersion !== 1 || receipt.nonce !== nonce || receipt.stage !== stage || receipt.processId !== processReceipt.processId
				|| receipt.renderer.nonce !== nonce || receipt.renderer.stage !== stage || receipt.renderer.nodeExposed || receipt.blockedNetworkRequests.length) throw new Error('Actual stage receipt identity/security differs from its joined process.');
			if (receipt.renderer.externalArchiveOpen !== (stage === 2)) throw new Error('Actual OS archive delivery witness differs from its stage.');
			for (const key of ['sandbox', 'contextIsolation', 'webSecurity']) if (receipt.security[key] !== true) throw new Error(`Actual packaged ${key} is disabled.`);
			for (const key of ['nodeIntegration', 'nodeIntegrationInWorker', 'nodeIntegrationInSubFrames']) if (receipt.security[key] !== false) throw new Error(`Actual packaged ${key} is enabled.`);
			if (stage !== 2 && !receipt.rawRuntimeRequests.includes('lightscaper-app://bundle/runtime/libraw/0.22.2/libraw.wasm')) throw new Error('Main-process worker runtime witness is incomplete.');
			const expectedDownloads = stage === 1 ? 2 : stage === 3 ? 1 : 0;
			if (receipt.downloads.length !== expectedDownloads || receipt.observedDownloads.length !== expectedDownloads
				|| receipt.observedDownloads.some(value => !value.currentContents || !value.currentFrame || value.initiatorOrigin !== 'lightscaper-app://bundle')) throw new Error('Actual native download authority/inventory differs.');
			verifyCustody(receipt.renderer.final, fixtures);
			if (preceding && (receipt.renderer.initial?.fingerprint !== preceding.fingerprint || receipt.renderer.final.fingerprint !== preceding.fingerprint)) throw new Error('Fresh process persistence or actual restore changed complete Photo custody.');
			if (stage === 2 && (!receipt.renderer.final.namespace || receipt.renderer.final.namespace === preceding?.namespace)) throw new Error('Actual restore did not commit a distinct namespace.');
			if (stage === 3 && receipt.renderer.final.namespace !== preceding?.namespace) throw new Error('Third process did not reopen the restored namespace.');
			let pngReceipt: unknown = null, archiveReceipt: unknown = null;
			for (const [index, download] of receipt.downloads.entries()) {
				const suffix = index === 0 ? '.png' : '.liscape', output = join(root, `${nonce}.stage-${stage}.download-${index}${suffix}`);
				if (download.path !== output || download.state !== 'completed') throw new Error('Download path/state escaped its private completed stage.');
				const bytes = await boundedRead(output, 2 * 1024 * 1024);
				if (bytes.length !== download.byteLength || hash(bytes) !== download.sha256) throw new Error('Completed native output bytes differ from their receipt.');
				if (index === 0) pngReceipt = verifyLightscaperSmokePngCurrentV1(bytes, 32, 32, expectedPixels);
				else {
					archiveReceipt = await verifyLightscaperSmokeArchiveCurrentV1(new Uint8Array(bytes), receipt.renderer.final);
					archive = file(backupSuggestedName, 'application/vnd.soundscaper.scape+zip', bytes);
					await mkdir(join(root, 'incoming'), { mode: 0o700 }); archivePath = join(root, 'incoming', backupSuggestedName);
					await writeFile(archivePath, bytes, { flag: 'wx', mode: 0o600 });
				}
			}
			if (stage !== 2 && (!receipt.renderer.preview || receipt.renderer.preview.width !== 32 || receipt.renderer.preview.height !== 32
				|| receipt.renderer.preview.pixels.length !== expectedPixels.length || receipt.renderer.preview.pixels.some((value, index) => value !== expectedPixels[index]))) throw new Error('Actual Develop preview differs from the independent packaged RAW exposure oracle.');
			stages.push({ stage, process: processReceipt, nativeReceipt: receipt, png: pngReceipt, archive: archiveReceipt });
			preceding = receipt.renderer.final;
		}
		await rm(profile, { recursive: true, force: true });
		await writeFile(qualificationPath, `${JSON.stringify({ schemaVersion: 1, status: 'passed', nonce, executable,
			allowNoSandbox: options.allowNoSandbox, threeFreshProcesses: true, samePrivateProfile: true, profileRemoved: true,
			fixtures: fixtures.map(({ base64: _base64, ...value }) => value), stages }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
		complete = true;
		return qualificationPath;
	} catch (error) {
		let profileRemoved = false, cleanupError: string | null = null;
		if (allJoined) {
			try { await rm(profile, { recursive: true, force: true }); profileRemoved = true; }
			catch (cleanup) { cleanupError = cleanup instanceof Error ? cleanup.message : 'Private profile cleanup failed.'; }
		}
		await writeFile(join(root, 'failure.json'), `${JSON.stringify({ schemaVersion: 1, status: 'failed', nonce,
			message: error instanceof Error ? error.message : 'Unknown failure', allJoined, profileRemoved, profileRetained: !profileRemoved, cleanupError, stages }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
		throw error;
	} finally {
		expectedPixelsForCleanup?.fill(0);
		if (!complete && !allJoined) console.error(`Managed smoke retained diagnostic profile until process readers are verified retired: ${profile}`);
	}
}
function verifyCustody(value: LightscaperSmokeCustodyCurrentV1, fixtures: readonly LightscaperSmokeFileCurrentV1[]): void {
	if (value.photos.length !== 2) throw new Error('Native custody does not contain the complete two-photo fixture.');
	const actual = hash(new TextEncoder().encode(lightscaperSmokeStableJsonCurrentV1({ root: value.root,
		photos: value.photos.map(({ document, sha256, byteLength }) => ({ document, sha256, byteLength })) })));
	if (actual !== value.fingerprint) throw new Error('Native custody fingerprint does not authenticate its complete documents.');
	for (const photo of value.photos) {
		const document = photo.document as { metadata: { fileName: string }; original: { contentSha256: string; byteLength: number } };
		const fixture = fixtures.find(file => file.name === document.metadata.fileName);
		if (!fixture || photo.sha256 !== fixture.sha256 || photo.byteLength !== fixture.byteLength
			|| document.original.contentSha256 !== fixture.sha256 || document.original.byteLength !== fixture.byteLength) throw new Error('Native Original custody differs from the owned imported File.');
	}
}
async function boundedRead(path: string, maximum: number): Promise<Buffer> {
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > maximum) throw new Error('Smoke evidence is not a bounded regular file.');
	const bytes = await readFile(path); if (bytes.length !== metadata.size) throw new Error('Smoke evidence changed while reading.'); return bytes;
}
function file(name: string, mimeType: string, bytes: Uint8Array): LightscaperSmokeFileCurrentV1 {
	return { name, mimeType, base64: Buffer.from(bytes).toString('base64'), byteLength: bytes.length, sha256: hash(bytes) };
}
function ownedRaster(): Uint8Array<ArrayBuffer> {
	return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk('IHDR', Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0])), pngChunk('sRGB', Buffer.of(0)),
		pngChunk('IDAT', deflateSync(Buffer.from([0, 32, 64, 128, 255, 64, 128, 192, 255, 0, 96, 160, 224, 255, 128, 192, 240, 255]))), pngChunk('IEND', Buffer.alloc(0))]));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	void runLightscaperDesktopManagedSmokeCurrentV1(process.argv.slice(2)).then(path => { console.log(`Lightscaper packaged managed smoke passed: ${path}`); }, (error: unknown) => { console.error(error); process.exitCode = 1; });
}
