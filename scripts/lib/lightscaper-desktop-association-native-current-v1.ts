/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { associationFileCurrentV1 as file, associationReadCurrentV1 as read, associationRecordCurrentV1 as record, associationAbsoluteCurrentV1 as absolute } from './lightscaper-desktop-association-evidence-current-v1.ts';
import type { LightscaperAssociationProcessOwnerCurrentV1 } from './lightscaper-desktop-association-evidence-current-v1.ts';
import { runLightscaperDesktopManagedSmokeCurrentV1 } from '../lightscaper-desktop-managed-smoke-current-v1.ts';
import type { LightscaperRegisteredAssociationArchiveCurrentV1, LightscaperRegisteredAssociationPortCurrentV1 } from '../lightscaper-desktop-managed-smoke-current-v1.ts';

const MAC_KEYS = ['schemaVersion', 'nonce', 'target', 'sourceRevision', 'operation', 'status', 'bundlePath', 'executablePath',
	'bundleIdentifier', 'extension', 'documentName', 'documentRole', 'mimeType', 'archivePath', 'archiveSha256', 'primaryPid',
	'priorResolverBundlePath', 'resolverBundlePath', 'deliveredPid', 'deliveredBundlePath', 'deliveredExecutablePath', 'counters', 'error'];
const WINDOWS_KEYS = ['schemaVersion', 'kind', 'nonce', 'target', 'sourceRevision', 'operation', 'status', 'executablePath',
	'archivePath', 'archiveSha256', 'archiveByteLength', 'archiveStable', 'association', 'perUser', 'foreignDefaults',
	'foreignDefaultsUnchanged', 'primary', 'primaryStillLive', 'dispatch', 'returnedProcess', 'sameCallingJob',
	'returnedProcessJoined', 'returnedProcessExitCode', 'returnedProcessNaturalExit', 'returnedProcessHandleClosed', 'callingJob', 'nativeHandlesClosed', 'operationCounts', 'failure'];
const LINUX_KEYS = ['schemaVersion', 'nonce', 'target', 'sourceRevision', 'operation', 'status', 'executablePath', 'archivePath',
	'archiveSha256', 'primaryPid', 'contentType', 'mimeType', 'desktopFile', 'desktopId', 'exec', 'primary', 'secondary', 'callingProcessGroup', 'counters', 'error'];
const MIME = 'application/vnd.lightscaper.liscape+zip';
export interface LightscaperAssociationNativeOptionsCurrentV1 {
	readonly target: string; readonly sourceRevision: string; readonly executablePath: string;
	readonly helperPath: string; readonly helperSha256: string; readonly evidenceRoot: string;
	readonly bundlePath?: string; readonly desktopFile?: string; readonly processOwner: LightscaperAssociationProcessOwnerCurrentV1;
}
export type LightscaperNativeAssociationOperationCurrentV1 = 'register' | 'open' | 'unregister';

/** A result is admitted only after the authenticated native helper's actual
 * supervisor has joined. The parser by itself grants no dispatch authority. */
export async function runLightscaperNativeAssociationCurrentV1(options: Readonly<LightscaperAssociationNativeOptionsCurrentV1>,
	operation: LightscaperNativeAssociationOperationCurrentV1,
	archive: Readonly<LightscaperRegisteredAssociationArchiveCurrentV1 & { primaryPid?: number }>): Promise<unknown> {
	const helper = await file(options.helperPath, 64 * 1024 ** 2), input = await file(archive.archivePath, 64 * 1024 ** 2);
	if (helper.sha256 !== options.helperSha256 || input.sha256 !== archive.archiveSha256) throw new Error('Native association helper/archive SHA differs from its exact admission.');
	const mac = options.target === 'mac-arm64';
	if (!mac && operation !== 'open') throw new TypeError('This platform helper only opens its real default.');
	const folder = await mkdtemp(join(options.evidenceRoot, `native-association-${operation}-`));
	const platform = mac ? 'mac' : options.target.startsWith('win-') ? 'windows' : 'linux';
	const requestPath = join(folder, `${archive.nonce}.${platform}-association-request.json`), resultPath = join(folder, `${archive.nonce}.${platform}-association-result.json`);
	const request = { schemaVersion: 1, nonce: archive.nonce, target: options.target, sourceRevision: options.sourceRevision, operation,
		...(mac ? { bundlePath: options.bundlePath } : {}), executablePath: options.executablePath,
		archivePath: archive.archivePath, archiveSha256: archive.archiveSha256, primaryPid: archive.primaryPid ?? 0 };
	await writeFile(requestPath, `${JSON.stringify(request)}\n`, { flag: 'wx', mode: 0o600 });
	const processReceipt = await options.processOwner.run(options.helperPath, ['--request', requestPath, '--result', resultPath], { deadlineMs: 60_000 });
	const result: unknown = JSON.parse((await read(resultPath, 256 * 1024)).toString('utf8'));
	validateResult(result, options, operation, archive, input.byteLength);
	return Object.freeze({ request: await file(requestPath, 64 * 1024), result: await file(resultPath, 256 * 1024), process: processReceipt, native: result });
}
function validateResult(value: unknown, options: Readonly<LightscaperAssociationNativeOptionsCurrentV1>, operation: string,
	archive: Readonly<LightscaperRegisteredAssociationArchiveCurrentV1 & { primaryPid?: number }>, byteLength: number): void {
	const mac = options.target === 'mac-arm64', windows = options.target.startsWith('win-');
	const row = record(value, mac ? MAC_KEYS : windows ? WINDOWS_KEYS : LINUX_KEYS);
	if (row.schemaVersion !== 1 || row.nonce !== archive.nonce || row.target !== options.target || row.sourceRevision !== options.sourceRevision
		|| row.operation !== operation || row.status !== 'passed' || row.executablePath !== options.executablePath
		|| row.archivePath !== archive.archivePath || row.archiveSha256 !== archive.archiveSha256) throw new Error('Actual native association result identity/status differs from its request.');
	if (mac) {
		const counts = record(row.counters, ['registerCalls', 'resolverQueries', 'openCalls', 'completionCalls', 'unregisterToolStarts', 'unregisterToolExitCode', 'unregisterToolReaped', 'postUnregisterMatches']);
		if (row.bundlePath !== options.bundlePath || row.bundleIdentifier !== 'org.lightscaper.desktop' || row.extension !== 'liscape'
			|| row.documentName !== 'Lightscaper Catalog' || row.documentRole !== 'Editor' || row.mimeType !== null || row.error !== null
			|| row.primaryPid !== (archive.primaryPid ?? 0)) throw new Error('Installed macOS catalog declaration or primary differs.');
		if (operation === 'open' && (row.resolverBundlePath !== options.bundlePath || row.deliveredPid !== archive.primaryPid
			|| row.deliveredBundlePath !== options.bundlePath || row.deliveredExecutablePath !== options.executablePath
			|| counts.openCalls !== 1 || counts.completionCalls !== 1)) throw new Error('Default AppKit dispatch did not join the exact existing primary.');
		if (operation === 'register' && (counts.registerCalls !== 1 || row.resolverBundlePath !== options.bundlePath)) throw new Error('Actual owned Launch Services registration/default was not proved.');
		if (operation === 'unregister' && (counts.unregisterToolStarts !== 1 || counts.unregisterToolExitCode !== 0
			|| counts.unregisterToolReaped !== true || counts.postUnregisterMatches !== 0 || row.resolverBundlePath === options.bundlePath)) throw new Error('Actual owned Launch Services registration did not retire.');
		return;
	}
	if (windows) {
		const primary = record(row.primary, ['pid', 'creationTime100ns', 'executablePath']), opened = record(row.returnedProcess, ['pid', 'creationTime100ns', 'executablePath']);
		const dispatch = record(row.dispatch, ['api', 'verb', 'file', 'parameters', 'classOverride', 'noAsync', 'noCloseProcess', 'noUi', 'accepted', 'processHandleReturned']);
		const job = record(row.callingJob, ['helperPid', 'before', 'atDispatch', 'after', 'childrenRetired']);
		const counts = record(row.operationCounts, ['comInitializations', 'associationQueries', 'callingJobQueries', 'shellExecuteCalls']);
		const perUser = record(row.perUser, ['userChoiceProgId', 'classesProgId', 'openCommand', 'mutated']);
		if (row.kind !== 'lightscaper-windows-default-association-current-v1' || row.archiveByteLength !== byteLength || row.archiveStable !== true
			|| row.primaryStillLive !== true || primary.pid !== archive.primaryPid || primary.executablePath !== options.executablePath
			|| opened.pid === primary.pid || opened.executablePath !== options.executablePath || typeof opened.creationTime100ns !== 'string'
			|| !/^[0-9]+$/u.test(opened.creationTime100ns) || perUser.mutated !== false || row.foreignDefaultsUnchanged !== true
			|| counts.comInitializations !== 1 || counts.shellExecuteCalls !== 1 || typeof counts.associationQueries !== 'number' || counts.associationQueries < 1
			|| typeof counts.callingJobQueries !== 'number' || counts.callingJobQueries < 3
			|| row.sameCallingJob !== true || row.returnedProcessJoined !== true || row.returnedProcessExitCode !== 0
			|| row.returnedProcessNaturalExit !== true || row.returnedProcessHandleClosed !== true || row.nativeHandlesClosed !== true
			|| job.childrenRetired !== true || !Array.isArray(job.after) || job.after.length !== 1 || job.after[0] !== job.helperPid
			|| dispatch.api !== 'ShellExecuteExW' || dispatch.verb !== 'open' || dispatch.file !== archive.archivePath || dispatch.parameters !== null
			|| dispatch.classOverride !== false || dispatch.noAsync !== true || dispatch.noCloseProcess !== true || dispatch.noUi !== true
			|| dispatch.accepted !== true || dispatch.processHandleReturned !== true) throw new Error('Actual Shell default dispatch, per-user route, process identity or same-Job retirement is incomplete.');
		return;
	}
	const primary = record(row.primary, ['pid', 'startTime', 'executablePath', 'processGroup', 'alive']);
	const opened = record(row.secondary, ['pid', 'startTime', 'executablePath', 'processGroup', 'alive', 'waited', 'exited', 'exitCode', 'signal', 'pidClosed']);
	const counters = record(row.counters, ['contentTypeQueries', 'defaultHandlerQueries', 'launchCalls', 'pidCallbacks']);
	if (row.primaryPid !== archive.primaryPid || row.contentType !== MIME || row.mimeType !== MIME || row.desktopFile !== options.desktopFile
		|| row.desktopId !== (options.desktopFile ? basename(options.desktopFile) : null) || row.error !== null || primary.pid !== archive.primaryPid
		|| primary.executablePath !== options.executablePath || primary.alive !== true || opened.pid === primary.pid
		|| opened.executablePath !== options.executablePath || opened.processGroup !== row.callingProcessGroup || opened.waited !== true
		|| opened.alive !== false || opened.exited !== true || opened.exitCode !== 0 || opened.signal !== null || opened.pidClosed !== true
		|| counters.contentTypeQueries !== 2 || counters.defaultHandlerQueries !== 2 || counters.launchCalls !== 1 || counters.pidCallbacks !== 1) throw new Error('Actual GIO file-default route or owned secondary retirement is incomplete.');
}

/** Shared by the installed CI qualification and an explicitly isolated Linux
 * package trial. This owner grants warm dispatch/reopen evidence only; the
 * caller separately authenticates installer/artifact/resource provenance. */
export function createLightscaperNativeAssociationSmokeCurrentV1(options: Readonly<LightscaperAssociationNativeOptionsCurrentV1 & {
	profilePath: string; runtimeRoot: string; outputRoot: string;
	linuxRegistration?: (archivePath: string) => Promise<unknown>; installerRegistration?: unknown;
	windowsJobHelper?: string; windowsJobHelperSha256?: string;
}>) {
	const platform = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : process.platform;
	if (options.target !== `${platform}-${process.arch}` || !/^[a-f0-9]{40}$/u.test(options.sourceRevision) || !/^[a-f0-9]{64}$/u.test(options.helperSha256)) throw new TypeError('Association smoke requires the real target-native source/helper identity.');
	for (const path of [options.executablePath, options.helperPath, options.evidenceRoot, options.profilePath, options.runtimeRoot, options.outputRoot]) absolute(path);
	let appRetired = true, nativeRetired = true, attempted = false, closed = false, started = false;
	let archive: LightscaperRegisteredAssociationArchiveCurrentV1 | undefined, cleanup: unknown;
	const port: LightscaperRegisteredAssociationPortCurrentV1 = {
		sourceRevision: options.sourceRevision, profilePath: options.profilePath,
		async register(value) {
			archive = value; attempted = true;
			if (options.target === 'mac-arm64') {
				try { return await runLightscaperNativeAssociationCurrentV1(options, 'register', value); }
				finally { nativeRetired = options.processOwner.readersRetired; }
			}
			if (options.target.startsWith('linux-')) {
				if (!options.linuxRegistration) throw new Error('Actual private XDG registration is required.');
				return options.linuxRegistration(value.archivePath);
			}
			if (!options.installerRegistration) throw new Error('Actual per-user native installer registration is required.');
			return options.installerRegistration;
		},
		async open(value) {
			nativeRetired = false;
			const result = await runLightscaperNativeAssociationCurrentV1(options, 'open', value); nativeRetired = true; return result;
		},
		async close(readersRetired) {
			appRetired = readersRetired;
			if (!readersRetired || !nativeRetired || !options.processOwner.readersRetired) throw new Error('Actual primary/native opener consumers remain unretired; retaining installation/profile.');
			if (closed) return cleanup;
			if (options.target === 'mac-arm64' && attempted) {
				if (!archive) throw new Error('Actual owned archive is required to retire its Launch Services registration.');
				nativeRetired = false; cleanup = await runLightscaperNativeAssociationCurrentV1(options, 'unregister', archive); nativeRetired = true;
			} else cleanup = { actualNativeOpenerJoined: true, applicationReadersRetired: true };
			closed = true; return cleanup;
		},
	};
	return Object.freeze({ get readersRetired() { return appRetired && nativeRetired && options.processOwner.readersRetired; },
		get registrationRetired() { return closed; }, async run(): Promise<string> {
			if (started) throw new Error('Registered association smoke is a one-use process owner.'); started = true;
			if ((await file(options.helperPath, 64 * 1024 ** 2)).sha256 !== options.helperSha256) throw new Error('Actual native association helper bytes differ before app launch.');
			appRetired = false;
			return runLightscaperDesktopManagedSmokeCurrentV1(['--executable', options.executablePath, '--runtime-root', options.runtimeRoot,
				'--output-root', options.outputRoot, '--backend', 'web', '--scenario', 'managed', ...(process.platform === 'win32'
					? ['--windows-job-helper', options.windowsJobHelper ?? '', '--windows-job-helper-sha256', options.windowsJobHelperSha256 ?? ''] : [])], port);
		} });
}
