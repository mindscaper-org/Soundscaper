/* SPDX-License-Identifier: AGPL-3.0-only */

import {installLightscaperManagedSmokeRawObserverCurrentV1} from './lightscaper-managed-smoke-native-raw-current-v1.ts';
import { installLightscaperManagedSmokeNativeObserverCurrentV1 } from './lightscaper-managed-smoke-native-custody-current-v1.ts';
import { prepareLightscaperManagedSmokeRendererCurrentV1, runLightscaperManagedSmokeRendererCurrentV1 } from './lightscaper-managed-smoke-session-driver-current-v1.ts';
import { createHash } from 'node:crypto';
import { linkSync, lstatSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, dirname, join, resolve } from 'node:path';
import type { BrowserWindow, DownloadItem } from 'electron';
import type { LightscaperMainHooksCurrentV1 } from './lightscaper-main-host-current-v1.ts';
import type { LightscaperManagedSmokePlanCurrentV1, LightscaperSmokeFileCurrentV1 } from './lightscaper-managed-smoke-contract-current-v1.ts';

const PLAN_FLAG = '--lightscaper-managed-smoke-plan=';
const NONCE_FLAG = '--lightscaper-managed-smoke-nonce=';
const MAX_PLAN_BYTES = 4 * 1024 ** 2, MAX_OUTPUT_BYTES = 2 * 1024 ** 2;

export function parseLightscaperManagedSmokeArgumentsCurrentV1(argv: readonly string[]): Readonly<{ planPath: string; nonce: string }> | null {
	const selected = argv.filter(value => value.startsWith('--lightscaper-managed-smoke'));
	if (!selected.length) return null;
	const plans = selected.filter(value => value.startsWith(PLAN_FLAG)), nonces = selected.filter(value => value.startsWith(NONCE_FLAG));
	if (selected.length !== 2 || plans.length !== 1 || nonces.length !== 1) throw new TypeError('Managed Lightscaper smoke requires exactly one private plan and nonce.');
	const planPath = plans[0]!.slice(PLAN_FLAG.length), nonce = nonces[0]!.slice(NONCE_FLAG.length);
	if (!isAbsolute(planPath) || planPath.includes('\0') || resolve(planPath) !== planPath || !/^[a-f0-9]{32}$/u.test(nonce)) throw new TypeError('Invalid managed Lightscaper smoke authority.');
	return Object.freeze({ planPath, nonce });
}
export function validateLightscaperManagedSmokePlanCurrentV1(value: unknown, authority: Readonly<{ planPath: string; profilePath: string; nonce: string }>): LightscaperManagedSmokePlanCurrentV1 {
	const plan = record(value, ['schemaVersion', 'nonce', 'stage', 'profilePath', 'renderer'], ['registeredAssociation']);
	const stage = plan.stage;
	if (plan.schemaVersion !== 1 || plan.nonce !== authority.nonce || (stage !== 1 && stage !== 2 && stage !== 3)
		|| authority.planPath !== join(dirname(authority.planPath), `${authority.nonce}.stage-${stage}.json`)
		|| plan.profilePath !== resolve(authority.profilePath) || !isAbsolute(authority.profilePath)
		|| plan.registeredAssociation === undefined && plan.profilePath !== join(dirname(authority.planPath), 'profile')) throw new TypeError('Managed smoke plan leaves its private profile or stage.');
	const renderer = record(plan.renderer, ['nonce', 'stage', 'locale', 'fixtures', 'archive', 'expectedFingerprint', 'expectedNamespace', 'expectedPhotoIds', 'backupSuggestedName'], ['backend','scenario']);
	if (plan.registeredAssociation !== undefined) {
		const association = record(plan.registeredAssociation, ['schemaVersion', 'ownerNonce', 'sourceRevision']);
		if (association.schemaVersion !== 1 || association.ownerNonce !== authority.nonce
			|| typeof association.sourceRevision !== 'string' || !/^[a-f0-9]{40}$/u.test(association.sourceRevision)
			|| renderer.backend !== 'web' || renderer.scenario !== 'managed') throw new TypeError('Registered association smoke requires its exact owned managed-Web profile.');
	}
	if(renderer.scenario!==undefined&&renderer.scenario!=='managed'&&renderer.scenario!=='linked')throw new TypeError('Unknown finite smoke scenario.');
	if(renderer.scenario==='linked'&&renderer.backend!=='native')throw new TypeError('Linked smoke requires native storage.');
	if (renderer.backend !== undefined && renderer.backend !== 'web' && renderer.backend !== 'native') throw new TypeError('Unknown managed backend.');
	if (renderer.nonce !== plan.nonce || renderer.stage !== stage || renderer.locale !== 'en'
		|| !safeFilename(renderer.backupSuggestedName, '.liscape')
		|| !Array.isArray(renderer.fixtures) || renderer.fixtures.length !== 2) throw new TypeError('Managed smoke renderer authority expanded.');
	const fixtures = renderer.fixtures.map(file => validateFile(file, 65_536));
	if (fixtures[0]?.mimeType !== 'image/png' || fixtures[1]?.mimeType !== 'image/x-adobe-dng' || !fixtures[0].name.endsWith('.png') || !fixtures[1].name.endsWith('.dng')) throw new TypeError('Managed smoke fixture inventory changed.');
	if (stage === 1 ? renderer.expectedFingerprint !== null : !digest(renderer.expectedFingerprint)) throw new TypeError('Managed smoke requires its preceding durable fingerprint.');
	if (stage === 1 ? renderer.expectedPhotoIds !== null : !Array.isArray(renderer.expectedPhotoIds) || renderer.expectedPhotoIds.length !== 2
		|| new Set(renderer.expectedPhotoIds).size !== 2 || renderer.expectedPhotoIds.some(value => typeof value !== 'string' || !/^[a-f0-9-]{36}$/u.test(value))) throw new TypeError('Managed smoke requires its preceding two Photo identities.');
	if (renderer.expectedNamespace !== null && !/^[a-f0-9]{32}$/u.test(String(renderer.expectedNamespace))) throw new TypeError('Invalid restored namespace.');
	if (stage === 2&&renderer.scenario!=='linked') validateFile(renderer.archive, 1_048_576); else if (renderer.archive !== null) throw new TypeError('Only restore stage accepts an archive input.');
	return value as LightscaperManagedSmokePlanCurrentV1;
}

/** This factory activates only for the paired private CLI authority. The
	* production preload receives no smoke method and no filesystem path. */
export function createLightscaperManagedSmokeHooksCurrentV1(options: Readonly<{
	argv: readonly string[]; profilePath: string; rendererScript: string;
	relocateApplicationData?: (profilePath: string) => void;
	quit: () => void; reportFailure: (error: unknown) => void;
}>): LightscaperMainHooksCurrentV1 | undefined {
	const authority = parseLightscaperManagedSmokeArgumentsCurrentV1(options.argv);
	if (!authority) return undefined;
	const root = dirname(authority.planPath), rootMetadata = lstatSync(root), fileMetadata = lstatSync(authority.planPath);
	if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink() || realpathSync(root) !== root
		|| !fileMetadata.isFile() || fileMetadata.isSymbolicLink() || fileMetadata.size > MAX_PLAN_BYTES || fileMetadata.size < 2
		|| !options.rendererScript || options.rendererScript.length > 8 * 1024 ** 2) throw new TypeError('Managed smoke requires a real bounded private plan and inventoried renderer.');
	const profileMetadata = lstatSync(options.profilePath);
	if (!profileMetadata.isDirectory() || profileMetadata.isSymbolicLink() || realpathSync(options.profilePath) !== options.profilePath) throw new TypeError('Managed smoke requires its canonical private browser profile.');
	const plan = validateLightscaperManagedSmokePlanCurrentV1(JSON.parse(readFileSync(authority.planPath, 'utf8')) as unknown,
		{ ...authority, profilePath: options.profilePath });
	if (plan.registeredAssociation) validateAssociationProfile(plan, root, options.argv);
	for (const file of [...plan.renderer.fixtures, ...(plan.renderer.archive ? [plan.renderer.archive] : [])]) {
		const bytes = Buffer.from(file.base64, 'base64');
		if (bytes.length !== file.byteLength || hash(bytes) !== file.sha256) throw new Error('Managed smoke fixture bytes differ from their private plan.');
	}
	const linked=plan.renderer.scenario==='linked';
	const linkedRoot=join(root,'linked-sources');
	if(linked){const metadata=lstatSync(linkedRoot);if(!metadata.isDirectory()||metadata.isSymbolicLink()||realpathSync(linkedRoot)!==linkedRoot)throw new TypeError('Linked smoke chooser requires its owned actual source directory.');}
	// Isolated smoke needs a private native library; OS dispatch must preserve
	// the same default appData/userData identity as its ordinary secondary.
	if (!plan.registeredAssociation) options.relocateApplicationData?.(plan.profilePath);
	const native = plan.renderer.backend === 'native' ? installLightscaperManagedSmokeNativeObserverCurrentV1(linked?{scenario:'linked',allowUnavailable:plan.stage===2,appDataPath:plan.profilePath}:{}) : undefined;
	const raw=linked?installLightscaperManagedSmokeRawObserverCurrentV1():undefined;

	const pngSuggestedName = `${plan.renderer.fixtures[1]!.name.slice(0, -4)}.png`;
	const expected = plan.stage === 1 ? [pngSuggestedName, plan.renderer.backupSuggestedName]
		: plan.stage === 3 || linked ? [pngSuggestedName] : [];
	const downloads = expected.map((suggestedName, index) => ({ suggestedName, index, ...deferred<unknown>() }));
	for (const download of downloads) void download.promise.catch(() => undefined);
	const blockedNetworkRequests: string[] = [], observedDownloads: unknown[] = [], rawRuntimeRequests = new Set<string>();
	let next = 0, executed = false, failed: unknown;
	const resultPath = join(root, `${plan.nonce}.stage-${plan.stage}.result.json`);
	const timeout = setTimeout(() => { options.reportFailure(new Error(`Managed desktop stage ${plan.stage} timed out; downloads ${JSON.stringify(observedDownloads)}`)); }, 180_000);
	return Object.freeze({
		...(linked?{chooseLinkedRoot:async(signal?:AbortSignal)=>{signal?.throwIfAborted();const metadata=lstatSync(linkedRoot);if(!metadata.isDirectory()||metadata.isSymbolicLink()||realpathSync(linkedRoot)!==linkedRoot)throw new Error('Owned linked chooser directory changed.');return Object.freeze({path:Object.freeze({encoding:process.platform==='win32'?'windows-utf16le' as const:'posix-bytes' as const,bytes:new Uint8Array(Buffer.from(linkedRoot,process.platform==='win32'?'utf16le':'utf8'))}),displayName:'Owned linked sources'});}}:{}),
		beforeArchiveReady: async (window: BrowserWindow) => {
			try { await prepareLightscaperManagedSmokeRendererCurrentV1(window, options.rendererScript, plan.renderer); }
			catch (primary) { try { await native?.close();await raw?.close(); } catch (cleanup) { throw new AggregateError([primary, cleanup], 'Smoke native preparation and observer retirement failed.', { cause: cleanup }); } throw primary; }
		},
		onWindowCreated(window: BrowserWindow) {
			window.webContents.on('console-message', details => {
				if (details.level === 'error') console.error('Lightscaper smoke renderer:', details.message.slice(0, 2048));
			});
			window.webContents.session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
				const url = new URL(details.url), blocked = url.protocol === 'http:' || url.protocol === 'https:';
				if (url.protocol === 'lightscaper-app:' && url.host === 'bundle' && url.pathname.startsWith('/runtime/libraw/')) rawRuntimeRequests.add(url.href);
				if (blocked && blockedNetworkRequests.length < 32) blockedNetworkRequests.push(`${url.protocol}//${url.host}${url.pathname}`.slice(0, 512));
				callback({ cancel: blocked });
			});
			window.webContents.session.on('will-download', (_event, item, contents, frame) => {
				if (observedDownloads.length < 4) observedDownloads.push({ filename: item.getFilename(), url: item.getURL(),
					initiatorOrigin: item.getInitiatorOrigin(), currentContents: contents === window.webContents,
					currentFrame: frame === contents.mainFrame, frameUrl: frame?.url ?? null });
			});
		},
		onDownload(item: DownloadItem): boolean {
			const admission = downloads[next++];
			if (!admission || item.getFilename() !== admission.suggestedName) {
				failed = new Error(`Unplanned managed desktop download: ${item.getFilename()}`); item.cancel();
				for (const pending of downloads) pending.reject(failed); return true;
			}
			const output = join(root, `${plan.nonce}.stage-${plan.stage}.download-${admission.index}${admission.suggestedName.endsWith('.png') ? '.png' : '.liscape'}`);
			try { lstatSync(output); throw new Error('Native smoke output already exists.'); } catch (error) {
				if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) { admission.reject(error); item.cancel(); return true; }
			}
			item.setSavePath(output);
			item.once('done', (_event, state) => {
				try {
					if (state !== 'completed') throw new Error(`Native download did not complete: ${state}`);
					const metadata = lstatSync(output);
					if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 8 || metadata.size > MAX_OUTPUT_BYTES) throw new Error('Native smoke output exceeds its bounded file authority.');
					const bytes = readFileSync(output);
					admission.resolve({ path: output, suggestedName: admission.suggestedName, byteLength: bytes.length, sha256: hash(bytes), state });
				} catch (error) { admission.reject(error); }
			});
			return true;
		},
		async onRendererReady(window: BrowserWindow): Promise<void> {
			if (executed) return; executed = true;
			try {
				if (plan.registeredAssociation && plan.stage === 2) publishAssociationReady(plan, root);
				const report = await runLightscaperManagedSmokeRendererCurrentV1(window, plan.renderer, native);
				if (report.scenario !== (plan.renderer.scenario ?? 'managed') || report.backend !== (plan.renderer.backend ?? 'web') || report.nonce !== plan.nonce || report.stage !== plan.stage || JSON.stringify(report).length > 512 * 1024) throw new Error('Managed renderer report escaped its stage authority.');
				const completed = await Promise.all(downloads.map(download => download.promise));
				if (failed || next !== expected.length) throw failed ?? new Error('Managed smoke download inventory is incomplete.');
				if (blockedNetworkRequests.length) throw new Error('Offline managed smoke attempted external networking.');
				if ((!linked&&plan.stage!==2) && !rawRuntimeRequests.has('lightscaper-app://bundle/runtime/libraw/0.22.2/libraw.wasm')) throw new Error('Actual RAW worker did not request its packaged pinned runtime.');
				// Use the actual host inspection method when available; it sits outside
				// public declarations. Fail qualification if the actual host lacks it.
				const contents = window.webContents as unknown as { getLastWebPreferences?: () => Electron.WebPreferences };
				if (typeof contents.getLastWebPreferences !== 'function') throw new Error('Actual window preferences are unavailable.');
				const preferences = contents.getLastWebPreferences();
				await raw?.settle();const nativeRaw=raw?.snapshot();if(linked&&(!nativeRaw||nativeRaw.decoded<1||nativeRaw.active!==0||nativeRaw.wiped!==nativeRaw.decoded||nativeRaw.retired<nativeRaw.decoded||!nativeRaw.samples.some(sample=>sample.mode==='neutral'&&sample.format==='rgba16le'&&sample.width===32&&sample.height===32)))throw new Error('Actual native RAW provenance/retirement witness is incomplete.');
				const receipt = { schemaVersion: 1, nonce: plan.nonce, stage: plan.stage, processId: process.pid,
					nativeRaw,renderer: report, downloads: completed, blockedNetworkRequests, observedDownloads, rawRuntimeRequests: [...rawRuntimeRequests],
					security: { sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation,
						nodeIntegration: preferences.nodeIntegration, nodeIntegrationInWorker: preferences.nodeIntegrationInWorker,
						nodeIntegrationInSubFrames: preferences.nodeIntegrationInSubFrames, webSecurity: preferences.webSecurity } };
				await native?.close();await raw?.close();
				writeFileSync(resultPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
				clearTimeout(timeout); options.quit();
			} catch (primary) { clearTimeout(timeout); let failure: unknown = primary;
				try { await native?.close();await raw?.close(); } catch (cleanup) { failure = new AggregateError([primary, cleanup], 'Smoke workflow and native observer retirement failed.', { cause: primary }); }
				options.reportFailure(failure); throw failure; }
		},
	});
}
function validateAssociationProfile(plan: LightscaperManagedSmokePlanCurrentV1, root: string, argv: readonly string[]): void {
	if (!plan.registeredAssociation || argv.some(value => value === '--user-data-dir' || value.startsWith('--user-data-dir='))) throw new TypeError('OS association smoke must use the actual default Electron profile.');
	const markerPath = join(plan.profilePath, '.lightscaper-registered-association-owner.json'), metadata = lstatSync(markerPath);
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 2 || metadata.size > 4096
		|| realpathSync(markerPath) !== markerPath || process.getuid && (metadata.uid !== process.getuid() || (metadata.mode & 0o077) !== 0)) throw new Error('Registered association profile has no bounded private owner marker.');
	const marker = record(JSON.parse(readFileSync(markerPath, 'utf8')) as unknown,
		['schemaVersion', 'kind', 'ownerRoot', 'profilePath', 'nonce', 'sourceRevision', 'profileDevice', 'profileInode']);
	const profile = lstatSync(plan.profilePath);
	if (marker.schemaVersion !== 1 || marker.kind !== 'lightscaper-registered-association-profile-current-v1'
		|| marker.ownerRoot !== root || marker.profilePath !== plan.profilePath || marker.nonce !== plan.nonce
		|| marker.sourceRevision !== plan.registeredAssociation.sourceRevision || marker.profileDevice !== String(profile.dev)
		|| marker.profileInode !== String(profile.ino)) throw new Error('Registered association profile does not belong to this actual smoke composition.');
}
function publishAssociationReady(plan: LightscaperManagedSmokePlanCurrentV1, root: string): void {
	const association = plan.registeredAssociation, archive = plan.renderer.archive;
	if (!association || !archive || plan.stage !== 2) throw new Error('Only the genuine restore stage may publish association readiness.');
	const path = join(root, `${plan.nonce}.stage-2.ready.json`), pending = `${path}.pending`;
	writeFileSync(pending, `${JSON.stringify({ schemaVersion: 1, kind: 'lightscaper-registered-association-ready-current-v1',
		nonce: plan.nonce, sourceRevision: association.sourceRevision, profilePath: plan.profilePath,
		archiveName: archive.name, archiveSha256: archive.sha256, stage: 2, processId: process.pid })}\n`, { flag: 'wx', mode: 0o600 });
	try { linkSync(pending, path); } finally { unlinkSync(pending); }
}
function validateFile(value: unknown, maximum: number): LightscaperSmokeFileCurrentV1 {
	const file = record(value, ['name', 'mimeType', 'base64', 'byteLength', 'sha256']);
	if (!safeFilename(file.name) || typeof file.mimeType !== 'string' || file.mimeType.length > 128
		|| typeof file.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/u.test(file.base64) || file.base64.length > Math.ceil(maximum / 3) * 4
		|| typeof file.byteLength !== 'number' || !Number.isSafeInteger(file.byteLength) || file.byteLength < 1 || file.byteLength > maximum || !digest(file.sha256)) throw new TypeError('Invalid managed smoke File input.');
	return value as LightscaperSmokeFileCurrentV1;
}
function safeFilename(value: unknown, suffix = ''): value is string {
	return typeof value === 'string' && value.length > suffix.length && value.length <= 256 && !/[\\/\0\r\n]/u.test(value)
		&& value !== '.' && value !== '..' && value.endsWith(suffix);
}
function digest(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value); }
function record(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
		|| Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key) && !optional.includes(key)) || Reflect.ownKeys(value).length < keys.length) throw new TypeError('Managed smoke requires a closed record.');
	const output: Record<string, unknown> = {};
	for (const key of [...keys, ...optional.filter(key => Object.hasOwn(value, key))]) {
		const field = Object.getOwnPropertyDescriptor(value, key);
		if (!field || !field.enumerable || !Object.hasOwn(field, 'value')) throw new TypeError('Managed smoke requires own data fields.');
		output[key] = field.value;
	}
	return output;
}
function hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function deferred<Value>() {
	let resolve!: (value: Value) => void, reject!: (error: unknown) => void;
	const promise = new Promise<Value>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}
