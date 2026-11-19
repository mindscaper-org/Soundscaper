/* SPDX-License-Identifier: AGPL-3.0-only */

import { join } from 'node:path';
import { readStagedLightscaperPhotoNativeCurrentV1 as readNative, lightscaperPhotoRuntimeInventoryCurrentV1 as nativeInventory, LIGHTSCAPER_PHOTO_NATIVE_MANIFEST_CURRENT_V1 as nativeManifest } from './desktop-lightscaper-photo-native-current-v1.ts';
import { readLightscaperPhotoNativeBuildResultCurrentV1 as readNativeResult, type PhotoNativeBuildCurrentV1 } from '../../src/lightscaper/desktop-photo-native-artifacts-current-v1.ts';
import { DESKTOP_CODEC_POLICY, assertDesktopCodecPolicy, auditDesktopFfmpegAbsence } from './desktop-codec-policy.mjs';
import { readProductReleaseLines, resolveProductDesktopMetadata } from './product-release-lines.mjs';
import { verifyDesktopLightscaperRawRuntimeCurrentV1, type DesktopLightscaperRawReceiptCurrentV1 } from './desktop-lightscaper-raw-runtime-current-v1.ts';
import {
	assertLightscaperPackageEqualCurrentV1 as equal, captureLightscaperPackageFilesCurrentV1 as capture,
	lightscaperAbsoluteRootCurrentV1 as absolute, lightscaperClosedRecordCurrentV1 as record,
	lightscaperPackageDigestCurrentV1 as digest, normalizeLightscaperPackageFilesCurrentV1 as files,
	readLightscaperPackageFileCurrentV1 as read, type LightscaperPackageFileCurrentV1,
} from './desktop-lightscaper-package-files-current-v1.ts';

export const LIGHTSCAPER_STAGE_MANIFEST_CURRENT_V1 = 'stage-manifest.json';
const APP_FILES = ['desktop/main.mjs', 'desktop/preload.cjs', 'desktop/product.json', 'package.json'];
const FIELDS = ['schemaVersion', 'kind', 'productId', 'applicationVersion', 'applicationVersionChannel', 'releaseChannel',
	'sourceRevision', 'target', 'productMetadata', 'desktopCodecPolicy', 'rawRuntime', 'files'];
const TARGET_IDS = new Set(['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']);
export interface LightscaperDesktopTargetCurrentV1 { readonly platform: 'linux' | 'mac' | 'win'; readonly arch: 'x64' | 'arm64' }
export interface LightscaperDesktopMetadataCurrentV1 {
	readonly schemaVersion: 1; readonly id: 'lightscaper'; readonly applicationVersion: string;
	readonly applicationVersionChannel: 'candidate'; readonly releaseChannel: 'deferred'; readonly updateTagPrefix: 'lightscaper-v';
}
export interface DesktopLightscaperStageReceiptCurrentV1 {
	readonly schemaVersion: 1; readonly kind: 'lightscaper-desktop-managed-web-core-v1'; readonly productId: 'lightscaper';
	readonly applicationVersion: string; readonly applicationVersionChannel: 'candidate'; readonly releaseChannel: 'deferred';
	readonly sourceRevision: string; readonly target: Readonly<LightscaperDesktopTargetCurrentV1>;
	readonly productMetadata: Readonly<LightscaperDesktopMetadataCurrentV1>;
	readonly nativePhotoRuntime?: PhotoNativeBuildCurrentV1;
	readonly desktopCodecPolicy: typeof DESKTOP_CODEC_POLICY; readonly rawRuntime: DesktopLightscaperRawReceiptCurrentV1;
	readonly files: Readonly<{ app: readonly LightscaperPackageFileCurrentV1[]; renderer: readonly LightscaperPackageFileCurrentV1[];
		licenses: readonly LightscaperPackageFileCurrentV1[] }>;
}
export interface CaptureDesktopLightscaperStageOptionsCurrentV1 {
	readonly repositoryRoot: string; readonly buildRoot: string; readonly productMetadata: unknown;
	readonly target: Readonly<LightscaperDesktopTargetCurrentV1>; readonly sourceRevision: string;
}

/** Prepare owns this receipt only after the complete renderer, runtime and notices exist. */
export async function captureDesktopLightscaperStageCurrentV1(options: Readonly<CaptureDesktopLightscaperStageOptionsCurrentV1>): Promise<DesktopLightscaperStageReceiptCurrentV1> {
	const repositoryRoot = absolute(options.repositoryRoot), root = absolute(options.buildRoot);
	const metadata = await metadataFor(repositoryRoot, options.productMetadata), target = normalizeLightscaperDesktopTargetCurrentV1(options.target);
	if (!/^[a-f0-9]{40}$/u.test(options.sourceRevision)) throw new TypeError('Lightscaper source revision must be a full commit ID.');
	const rawRuntime = await verifyDesktopLightscaperRawRuntimeCurrentV1({ runtimeRoot: join(root, 'runtime') });
	const nativePhotoRuntime = await readNative({ repositoryRoot, appRoot: join(root, 'app'), runtimeRoot: join(root, 'runtime'), target: `${target.platform}-${target.arch}`, sourceRevision: options.sourceRevision });
	equal(await capture(join(root, 'runtime')), [...rawRuntime.files, ...nativeInventory(nativePhotoRuntime)].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), 'RAW/native runtime inventory');
	const app = await capture(join(root, 'app')), renderer = await capture(join(root, 'renderer')), licenses = await capture(join(root, 'licenses'));
	equal(app.map(file => file.path), [...APP_FILES, ...(nativePhotoRuntime ? [nativeManifest] : [])].sort(), 'application member inventory');
	await verifyAppIdentity(root, metadata);
	if (!renderer.some(file => file.path === 'index.html')) throw new Error('Lightscaper renderer has no entry document.');
	await verifyLicenses(repositoryRoot, licenses);
	await auditDesktopFfmpegAbsence({ root: join(root, 'app'), label: 'Lightscaper staged application' });
	await auditDesktopFfmpegAbsence({ root: join(root, 'renderer'), label: 'Lightscaper staged renderer' });
	await auditDesktopFfmpegAbsence({ root: join(root, 'runtime'), label: 'Lightscaper staged runtime' });
	return Object.freeze({ schemaVersion: 1, kind: 'lightscaper-desktop-managed-web-core-v1', productId: 'lightscaper',
		applicationVersion: metadata.applicationVersion, applicationVersionChannel: 'candidate', releaseChannel: 'deferred',
		sourceRevision: options.sourceRevision, target, productMetadata: metadata, desktopCodecPolicy: DESKTOP_CODEC_POLICY,
		rawRuntime, ...(nativePhotoRuntime ? { nativePhotoRuntime } : {}), files: Object.freeze({ app, renderer, licenses }) });
}

export async function verifyDesktopLightscaperStageCurrentV1({ repositoryRoot, buildRoot, target }: Readonly<{
	repositoryRoot: string; buildRoot: string; target: Readonly<LightscaperDesktopTargetCurrentV1>;
}>): Promise<DesktopLightscaperStageReceiptCurrentV1> {
	const root = absolute(buildRoot);
	const bytes = await read(root, LIGHTSCAPER_STAGE_MANIFEST_CURRENT_V1, 8 * 1024 ** 2);
	const value: unknown = JSON.parse(bytes.toString('utf8'));
	const receipt = normalizeLightscaperStageReceiptCurrentV1(value);
	equal(receipt.target, normalizeLightscaperDesktopTargetCurrentV1(target), 'packaging target');
	const actual = await captureDesktopLightscaperStageCurrentV1({ repositoryRoot, buildRoot: root,
		productMetadata: receipt.productMetadata, target: receipt.target, sourceRevision: receipt.sourceRevision });
	equal(receipt, actual, 'stage receipt');
	return actual;
}

export function normalizeLightscaperDesktopTargetCurrentV1(value: unknown): Readonly<LightscaperDesktopTargetCurrentV1> {
	const row = record(value, ['platform', 'arch']);
	const platform = row.platform, arch = row.arch;
	if ((platform !== 'linux' && platform !== 'mac' && platform !== 'win') || (arch !== 'x64' && arch !== 'arm64')
		|| !TARGET_IDS.has(`${platform}-${arch}`)) throw new TypeError('Lightscaper desktop target is unsupported.');
	return Object.freeze({ platform, arch });
}
export function normalizeLightscaperStageReceiptCurrentV1(value: unknown): DesktopLightscaperStageReceiptCurrentV1 {
	const hasNative = value !== null && typeof value === 'object' && Object.hasOwn(value, 'nativePhotoRuntime');
	const row = record(value, [...FIELDS, ...(hasNative ? ['nativePhotoRuntime'] : [])]), scopes = record(row.files, ['app', 'renderer', 'licenses']);
	const metadata = normalizeMetadata(row.productMetadata);
	const target = normalizeLightscaperDesktopTargetCurrentV1(row.target), nativePhotoRuntime = hasNative ? readNativeResult(row.nativePhotoRuntime) : undefined;
	if (nativePhotoRuntime && (nativePhotoRuntime.sourceRevision !== row.sourceRevision || nativePhotoRuntime.target !== `${target.platform}-${target.arch}`)) throw new TypeError('Lightscaper native receipt differs from the enclosing stage target/source.');
	if (row.schemaVersion !== 1 || row.kind !== 'lightscaper-desktop-managed-web-core-v1' || row.productId !== 'lightscaper'
		|| row.applicationVersion !== metadata.applicationVersion || row.applicationVersionChannel !== 'candidate' || row.releaseChannel !== 'deferred'
		|| typeof row.sourceRevision !== 'string' || !/^[a-f0-9]{40}$/u.test(row.sourceRevision)) {
		throw new TypeError('Lightscaper desktop stage identity is invalid.');
	}
	assertDesktopCodecPolicy(row.desktopCodecPolicy);
	const raw = record(row.rawRuntime, ['schemaVersion', 'kind', 'totalByteLength', 'files']), rawFiles = files(raw.files);
	const totalByteLength = raw.totalByteLength;
	if (raw.schemaVersion !== 1 || raw.kind !== 'lightscaper-desktop-pinned-libraw-wasm-v1'
		|| typeof totalByteLength !== 'number' || !Number.isSafeInteger(totalByteLength)
		|| totalByteLength !== rawFiles.reduce((total, file) => total + file.byteLength, 0)) {
		throw new TypeError('Lightscaper desktop RAW receipt is invalid.');
	}
	return Object.freeze({ schemaVersion: 1, kind: 'lightscaper-desktop-managed-web-core-v1', productId: 'lightscaper',
		applicationVersion: metadata.applicationVersion, applicationVersionChannel: 'candidate', releaseChannel: 'deferred',
		sourceRevision: row.sourceRevision, target, productMetadata: metadata,
		desktopCodecPolicy: DESKTOP_CODEC_POLICY, rawRuntime: Object.freeze({ schemaVersion: 1,
			kind: 'lightscaper-desktop-pinned-libraw-wasm-v1', totalByteLength, files: rawFiles }),
		...(nativePhotoRuntime ? { nativePhotoRuntime } : {}),
		files: Object.freeze({ app: files(scopes.app), renderer: files(scopes.renderer), licenses: files(scopes.licenses) }) });
}

async function metadataFor(repositoryRoot: string, value: unknown): Promise<Readonly<LightscaperDesktopMetadataCurrentV1>> {
	const metadata = normalizeMetadata(value);
	const releaseLines = await readProductReleaseLines(repositoryRoot);
	equal(metadata, resolveProductDesktopMetadata('lightscaper', releaseLines), 'release-line metadata');
	return metadata;
}
function normalizeMetadata(value: unknown): Readonly<LightscaperDesktopMetadataCurrentV1> {
	const row = record(value, ['schemaVersion', 'id', 'applicationVersion', 'applicationVersionChannel', 'releaseChannel', 'updateTagPrefix']);
	if (row.schemaVersion !== 1 || row.id !== 'lightscaper' || typeof row.applicationVersion !== 'string'
		|| !/^\d+\.\d+\.\d+-beta\.[A-Za-z0-9.]+$/u.test(row.applicationVersion) || row.applicationVersion.length > 80
		|| row.applicationVersionChannel !== 'candidate' || row.releaseChannel !== 'deferred' || row.updateTagPrefix !== 'lightscaper-v') {
		throw new TypeError('Lightscaper desktop metadata must name its deferred candidate release.');
	}
	return Object.freeze({ schemaVersion: 1, id: 'lightscaper', applicationVersion: row.applicationVersion,
		applicationVersionChannel: 'candidate', releaseChannel: 'deferred', updateTagPrefix: 'lightscaper-v' });
}
async function verifyAppIdentity(root: string, metadata: Readonly<LightscaperDesktopMetadataCurrentV1>): Promise<void> {
	const product: unknown = JSON.parse((await read(join(root, 'app'), 'desktop/product.json', 16 * 1024)).toString('utf8'));
	equal(product, metadata, 'packaged product metadata');
	const packageValue: unknown = JSON.parse((await read(join(root, 'app'), 'package.json', 16 * 1024)).toString('utf8'));
	const mandatory = ['name', 'productName', 'version', 'main', 'type', 'license'];
	const optional = ['desktopName', 'description', 'author', 'homepage'];
	if (packageValue === null || typeof packageValue !== 'object' || Array.isArray(packageValue)) throw new TypeError('Lightscaper package metadata is invalid.');
	const fields = Object.keys(packageValue);
	if (mandatory.some(field => !fields.includes(field)) || fields.some(field => !mandatory.includes(field) && !optional.includes(field))) {
		throw new TypeError('Lightscaper package metadata carries unsupported dependencies or fields.');
	}
	const pkg = record(packageValue, fields);
	if (pkg.name !== 'lightscaper-desktop' || pkg.productName !== 'Lightscaper' || pkg.version !== metadata.applicationVersion
		|| pkg.main !== 'desktop/main.mjs' || pkg.type !== 'module' || pkg.license !== 'AGPL-3.0-only'
		|| pkg.desktopName !== undefined && pkg.desktopName !== 'org.lightscaper.desktop'
		|| pkg.homepage !== undefined && pkg.homepage !== 'https://lightscaper.org') {
		throw new Error('Lightscaper package metadata does not match its product identity.');
	}
}
async function verifyLicenses(repositoryRoot: string, actual: readonly LightscaperPackageFileCurrentV1[]): Promise<void> {
	const expected = (await capture(join(repositoryRoot, 'LICENSES'))).map(file => ({ ...file, path: `LICENSES/${file.path}` }));
	for (const [source, destination] of [['LICENSE', 'Soundscaper-AGPL-3.0.txt'], ['THIRD_PARTY_LICENSES.md', 'THIRD_PARTY_LICENSES.md']]) {
		const bytes = await read(repositoryRoot, source!);
		expected.push({ path: destination!, byteLength: bytes.length, sha256: digest(bytes) });
	}
	expected.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
	equal(actual, expected, 'AGPL and third-party notices');
}
