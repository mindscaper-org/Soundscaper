/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, dirname, join, resolve } from 'node:path';
import type { BrowserWindow, DownloadItem } from 'electron';
import type { LightscaperMainHooksCurrentV1 } from './lightscaper-main-host-current-v1.ts';
import type { LightscaperManagedSmokePlanCurrentV1, LightscaperSmokeFileCurrentV1, LightscaperSmokeRendererReportCurrentV1 } from './lightscaper-managed-smoke-contract-current-v1.ts';

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
	const plan = record(value, ['schemaVersion', 'nonce', 'stage', 'profilePath', 'renderer']);
	const stage = plan.stage;
	if (plan.schemaVersion !== 1 || plan.nonce !== authority.nonce || (stage !== 1 && stage !== 2 && stage !== 3)
		|| authority.planPath !== join(dirname(authority.planPath), `${authority.nonce}.stage-${stage}.json`)
		|| plan.profilePath !== join(dirname(authority.planPath), 'profile') || plan.profilePath !== resolve(authority.profilePath)) throw new TypeError('Managed smoke plan leaves its private profile or stage.');
	const renderer = record(plan.renderer, ['nonce', 'stage', 'locale', 'fixtures', 'archive', 'expectedFingerprint', 'expectedNamespace', 'expectedPhotoIds', 'backupSuggestedName']);
	if (renderer.nonce !== plan.nonce || renderer.stage !== stage || renderer.locale !== 'en'
		|| !safeFilename(renderer.backupSuggestedName, '.liscape')
		|| !Array.isArray(renderer.fixtures) || renderer.fixtures.length !== 2) throw new TypeError('Managed smoke renderer authority expanded.');
	const fixtures = renderer.fixtures.map(file => validateFile(file, 65_536));
	if (fixtures[0]?.mimeType !== 'image/png' || fixtures[1]?.mimeType !== 'image/x-adobe-dng' || !fixtures[0].name.endsWith('.png') || !fixtures[1].name.endsWith('.dng')) throw new TypeError('Managed smoke fixture inventory changed.');
	if (stage === 1 ? renderer.expectedFingerprint !== null : !digest(renderer.expectedFingerprint)) throw new TypeError('Managed smoke requires its preceding durable fingerprint.');
	if (stage === 1 ? renderer.expectedPhotoIds !== null : !Array.isArray(renderer.expectedPhotoIds) || renderer.expectedPhotoIds.length !== 2
		|| new Set(renderer.expectedPhotoIds).size !== 2 || renderer.expectedPhotoIds.some(value => typeof value !== 'string' || !/^[a-f0-9-]{36}$/u.test(value))) throw new TypeError('Managed smoke requires its preceding two Photo identities.');
	if (renderer.expectedNamespace !== null && !/^[a-f0-9]{32}$/u.test(String(renderer.expectedNamespace))) throw new TypeError('Invalid restored namespace.');
	if (stage === 2) validateFile(renderer.archive, 1_048_576); else if (renderer.archive !== null) throw new TypeError('Only restore stage accepts an archive input.');
	return value as LightscaperManagedSmokePlanCurrentV1;
}

/** This factory activates only for the paired private CLI authority. The
 * production preload receives no smoke method and no filesystem path. */
export function createLightscaperManagedSmokeHooksCurrentV1(options: Readonly<{
	argv: readonly string[]; profilePath: string; rendererScript: string;
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
	for (const file of [...plan.renderer.fixtures, ...(plan.renderer.archive ? [plan.renderer.archive] : [])]) {
		const bytes = Buffer.from(file.base64, 'base64');
		if (bytes.length !== file.byteLength || hash(bytes) !== file.sha256) throw new Error('Managed smoke fixture bytes differ from their private plan.');
	}
	const pngSuggestedName = `${plan.renderer.fixtures[1]!.name.slice(0, -4)}.png`;
	const expected = plan.stage === 1 ? [pngSuggestedName, plan.renderer.backupSuggestedName]
		: plan.stage === 3 ? [pngSuggestedName] : [];
	const downloads = expected.map((suggestedName, index) => ({ suggestedName, index, ...deferred<unknown>() }));
	for (const download of downloads) void download.promise.catch(() => undefined);
	const blockedNetworkRequests: string[] = [], observedDownloads: unknown[] = [], rawRuntimeRequests = new Set<string>();
	let next = 0, executed = false, failed: unknown;
	const resultPath = join(root, `${plan.nonce}.stage-${plan.stage}.result.json`);
	const timeout = setTimeout(() => { options.reportFailure(new Error(`Managed desktop stage ${plan.stage} timed out; downloads ${JSON.stringify(observedDownloads)}`)); }, 180_000);
	return Object.freeze({
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
				const source = `(() => { ${options.rendererScript}\n; return LightscaperManagedSmokeCurrentV1.runLightscaperManagedSmokeCurrentV1(${JSON.stringify(plan.renderer)}); })()`;
				const report = await window.webContents.executeJavaScript(source, true) as LightscaperSmokeRendererReportCurrentV1;
				if (report.nonce !== plan.nonce || report.stage !== plan.stage || JSON.stringify(report).length > 512 * 1024) throw new Error('Managed renderer report escaped its stage authority.');
				const completed = await Promise.all(downloads.map(download => download.promise));
				if (failed || next !== expected.length) throw failed ?? new Error('Managed smoke download inventory is incomplete.');
				if (blockedNetworkRequests.length) throw new Error('Offline managed smoke attempted external networking.');
				if (plan.stage !== 2 && !rawRuntimeRequests.has('lightscaper-app://bundle/runtime/libraw/0.22.2/libraw.wasm')) throw new Error('Actual RAW worker did not request its packaged pinned runtime.');
				// Use the actual host inspection method when available; it sits outside
				// public declarations. Fail qualification if the actual host lacks it.
				const contents = window.webContents as unknown as { getLastWebPreferences?: () => Electron.WebPreferences };
				if (typeof contents.getLastWebPreferences !== 'function') throw new Error('Actual window preferences are unavailable.');
				const preferences = contents.getLastWebPreferences();
				const receipt = { schemaVersion: 1, nonce: plan.nonce, stage: plan.stage, processId: process.pid,
					renderer: report, downloads: completed, blockedNetworkRequests, observedDownloads, rawRuntimeRequests: [...rawRuntimeRequests],
					security: { sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation,
						nodeIntegration: preferences.nodeIntegration, nodeIntegrationInWorker: preferences.nodeIntegrationInWorker,
						nodeIntegrationInSubFrames: preferences.nodeIntegrationInSubFrames, webSecurity: preferences.webSecurity } };
				writeFileSync(resultPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
				clearTimeout(timeout); options.quit();
			} catch (error) { clearTimeout(timeout); options.reportFailure(error); throw error; }
		},
	});
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
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
		|| Reflect.ownKeys(value).length !== keys.length) throw new TypeError('Managed smoke requires a closed record.');
	const output: Record<string, unknown> = {};
	for (const key of keys) {
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
