/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createPackage } from '@electron/asar';
import beforePack from '../scripts/motionscaper-desktop-before-pack.mjs';
import afterPack from '../scripts/motionscaper-desktop-after-pack.mjs';
import { createMotionscaperStageInventory, verifyMotionscaperDesktopStage, verifyMotionscaperPackagedResources } from '../scripts/lib/motionscaper-desktop-package.mjs';
import { DESKTOP_CODEC_POLICY } from '../scripts/lib/desktop-codec-policy.mjs';
import * as nativeContract from '../desktop/motionscaper-native-payload.ts';
import * as signingOwner from '../scripts/lib/motionscaper-mac-signing.ts';

type Platform = 'darwin' | 'linux' | 'win32';
type Execute = (command: string, args: readonly string[]) => Promise<void>;
interface Context {
	electronPlatformName: Platform; arch: 'arm64' | 'x64'; appOutDir: string;
	packager: { projectDir: string; appInfo: { productFilename: string }; executableName: string; getResourcesDir(path: string): string };
}
interface Dependencies {
	environment: NodeJS.ProcessEnv; executeFile: Execute;
	verifyPackagedElectronAlternateFfmpeg(): Promise<void>; flipFuses(): Promise<void>;
}
interface SigningProof {
	schemaVersion: 1; kind: 'developer-id'; teamId: string;
	original: { byteLength: number; sha256: string; receiptSha256: string };
	signed: { byteLength: number; sha256: string };
}
const invokeBefore: (context: Context, dependencies: Dependencies) => Promise<unknown> = beforePack;
const invokeAfter: (context: Context, dependencies: Dependencies) => Promise<void> = afterPack;
const digest = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const SIGNATURE = Buffer.from('CONTROLLED-SIGNATURE');
const environment = { SCAPE_MAC_SIGNING: 'true', CSC_NAME: 'Developer ID Application: Controlled Test (ABCDEFGHIJ)', CSC_KEYCHAIN: '/controlled/keychain', APPLE_TEAM_ID: 'ABCDEFGHIJ' };
const json = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8')) as unknown;

/** Synthetic headers only: these fixtures are neither compiled nor credentialed signing evidence. */
function controlledBinary(platform: Platform): Buffer {
	const bytes = Buffer.alloc(platform === 'win32' ? 128 : 64);
	if (platform === 'darwin') { bytes.writeUInt32LE(0xfeedfacf); bytes.writeUInt32LE(0x0100000c, 4); }
	else if (platform === 'linux') { bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]); bytes.writeUInt16LE(62, 18); }
	else { bytes.write('MZ'); bytes.writeUInt32LE(64, 0x3c); bytes.write('PE\0\0', 64); bytes.writeUInt16LE(0x8664, 68); bytes.writeUInt16LE(0x20b, 88); }
	return bytes;
}
/** The production inventory/parser really admits the synthetic architecture fixture. */
async function fixture(t: TestContext, platform: Platform = 'darwin', helper = true) {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-mac-signing-')); t.after(() => rm(root, { recursive: true, force: true }));
	const stage = join(root, '.desktop-build'), resources = join(root, 'output/resources');
	for (const directory of ['app/desktop', 'renderer', 'runtime', 'licenses']) await mkdir(join(stage, directory), { recursive: true });
	for (const path of ['app/desktop/main.mjs', 'app/desktop/preload.cjs', 'app/desktop/product.json', 'app/package.json', 'renderer/index.html']) await writeFile(join(stage, path), path);
	const target: nativeContract.MotionNativePayloadTarget = platform === 'darwin' ? 'mac-arm64' : platform === 'linux' ? 'linux-x64' : 'win-x64';
	const binary = controlledBinary(platform);
	const original = join(root, 'compile-helper'), receipt = join(root, 'compile-receipt.json');
	await writeFile(original, binary); await chmod(original, 0o555);
	await writeFile(receipt, JSON.stringify({ sourceRevision: 'a'.repeat(40), payload: { byteLength: binary.length, sha256: digest(binary) } }));
	const receiptSha256 = digest(await readFile(receipt));
	const helperPath = nativeContract.motionscaperNativePayloadPath(target);
	const payload = { schemaVersion: 1, productId: 'motionscaper', helperContractVersion: 1, carrierVersion: 1, target,
		helper: helper ? { path: helperPath, byteLength: binary.length, sha256: digest(binary), receiptSha256 } : null };
	if (helper) { await mkdir(join(stage, 'runtime/motionscaper-media-host')); await cp(original, join(stage, helperPath)); await chmod(join(stage, helperPath), 0o555); }
	await writeFile(join(stage, 'app/desktop/native-payload.json'), `${JSON.stringify(payload, null, '\t')}\n`);
	await writeFile(join(stage, 'app/desktop/native-notices.md'), 'Controlled fixture notices, unchanged.');
	const stageManifest = { schemaVersion: 1, productId: 'motionscaper', nativeServiceProfile: 'motionscaper-desktop-v1',
		target: { platform: target.split('-')[0], arch: target.split('-')[1] }, nativeCapabilities: ['project-files-v1', ...(helper ? ['prores-4444-v1'] : [])],
		desktopCodecPolicy: DESKTOP_CODEC_POLICY, files: await createMotionscaperStageInventory(stage) };
	await writeFile(join(stage, 'stage-manifest.json'), `${JSON.stringify(stageManifest, null, '\t')}\n`);
	const context: Context = { electronPlatformName: platform, arch: platform === 'darwin' ? 'arm64' : 'x64', appOutDir: join(root, 'output'),
		packager: { projectDir: root, getResourcesDir: () => resources, appInfo: { productFilename: 'Motionscaper' }, executableName: 'motionscaper' } };
	const calls: { command: string; args: readonly string[] }[] = [];
	const executeFile: Execute = async (command, args) => {
		calls.push({ command, args }); const path = args.at(-1); assert.ok(path);
		if (args[0] === '--force') {
			assert.notEqual(path, original, 'immutable compile artifact must never be signed');
			await writeFile(path, Buffer.concat([await readFile(path), SIGNATURE]));
		} else if (args[0] === '--remove-signature') {
			const bytes = await readFile(path);
			if (bytes.subarray(-SIGNATURE.length).equals(SIGNATURE)) await writeFile(path, bytes.subarray(0, -SIGNATURE.length));
			else throw Object.assign(new Error('unsigned controlled original'), { stderr: 'code object is not signed at all' });
		}
	};
	const dependencies: Dependencies = { environment, executeFile, async flipFuses() {}, async verifyPackagedElectronAlternateFfmpeg() {} };
	return { root, stage, resources, original, receipt, binary, payload, context, calls, dependencies, helper: join(stage, helperPath),
		payloadPath: join(stage, 'app/desktop/native-payload.json'), stagePath: join(stage, 'stage-manifest.json'), target };
}
async function packageResources(f: Awaited<ReturnType<typeof fixture>>): Promise<void> {
	await mkdir(f.resources, { recursive: true }); await createPackage(join(f.stage, 'app'), join(f.resources, 'app.asar'));
	await cp(join(f.stage, 'renderer'), join(f.resources, 'renderer'), { recursive: true });
	await cp(join(f.stage, 'runtime'), join(f.resources, 'runtime'), { recursive: true });
}
function signing(value: unknown): SigningProof {
	assert.ok(value && typeof value === 'object'); const proof: unknown = Reflect.get(value, 'signing');
	assert.ok(proof && typeof proof === 'object', 'signed payload must retain its compile-to-signing derivation'); return proof as SigningProof;
}

test('Motion beforePack signs only its admitted Mac helper and packages the explicitly repinned derivative', async t => {
	const f = await fixture(t), receiptBefore = await readFile(f.receipt);
	await invokeBefore(f.context, f.dependencies);
	assert.equal(f.calls.filter(call => call.args[0] === '--force').length, 1, 'credentialed Motion beforePack must invoke its native helper signer');
	const verify = f.calls.find(call => call.args[0] === '--verify'); assert.ok(verify);
	const requirement = verify.args[verify.args.indexOf('--test-requirement') + 1]; assert.ok(requirement);
	for (const fragment of ['anchor apple generic', '1.2.840.113635.100.6.2.6', '1.2.840.113635.100.6.1.13', 'subject.OU', 'ABCDEFGHIJ']) assert.ok(requirement.includes(fragment), fragment);
	const payload = nativeContract.parseMotionscaperNativePayload(await json(f.payloadPath)); const proof = signing(payload);
	assert.deepEqual(proof.original, { byteLength: f.binary.length, sha256: digest(f.binary), receiptSha256: digest(receiptBefore) });
	assert.equal(proof.kind, 'developer-id'); assert.equal(proof.teamId, 'ABCDEFGHIJ'); assert.equal(proof.schemaVersion, 1);
	assert.deepEqual(proof.signed, { byteLength: (await readFile(f.helper)).length, sha256: digest(await readFile(f.helper)) });
	assert.equal(payload.helper?.receiptSha256, digest(receiptBefore)); assert.equal(payload.helper?.sha256, proof.signed.sha256);
	assert.deepEqual(await readFile(f.original), f.binary); assert.deepEqual(await readFile(f.receipt), receiptBefore);
	assert.equal((await lstat(f.helper)).mode & 0o777, 0o555); assert.equal(await realpath(f.helper), f.helper);
	await verifyMotionscaperDesktopStage(f.stage, f.target); await packageResources(f); await invokeAfter(f.context, f.dependencies);
});

for (const failure of ['tool', 'team', 'content', 'stage drift'] as const) test(`Motion signing refuses ${failure} without accepting replacement pins`, async t => {
	const f = await fixture(t), beforePayload = await readFile(f.payloadPath), beforeStage = await readFile(f.stagePath);
	const original = f.dependencies.executeFile;
	f.dependencies.executeFile = async (command, args) => {
		if (failure === 'tool' && args[0] === '--force') throw new Error('controlled signing tool failure');
		if (failure === 'team' && args[0] === '--verify') throw new Error('controlled wrong Team ID');
		await original(command, args); const path = args.at(-1); assert.ok(path);
		if (failure === 'content' && args[0] === '--force') { const bytes = await readFile(path); bytes[16] = bytes[16]! ^ 1; await writeFile(path, bytes); }
		if (failure === 'stage drift' && args[0] === '--verify') await writeFile(join(f.stage, 'renderer/index.html'), 'changed during signing');
	};
	await assert.rejects(invokeBefore(f.context, f.dependencies), /failure|Team|content|changed|inventory|digest/u);
	assert.deepEqual(await readFile(f.payloadPath), beforePayload); assert.deepEqual(await readFile(f.stagePath), beforeStage);
	assert.deepEqual(await readFile(f.original), f.binary);
});

for (const missing of ['CSC_KEYCHAIN', 'APPLE_TEAM_ID', 'CSC_NAME'] as const) test(`Motion Mac signing refuses missing ${missing} before touching the staged helper`, async t => {
	const f = await fixture(t), selected: NodeJS.ProcessEnv = { ...environment }; delete selected[missing];
	await assert.rejects(invokeBefore(f.context, { ...f.dependencies, environment: selected }), /credentials|identity|Team|keychain/u);
	assert.equal(f.calls.length, 0); assert.deepEqual(await readFile(f.helper), f.binary);
});

test('Motion Mac signing refuses a Developer ID identity for a different team', async t => {
	const f = await fixture(t);
	await assert.rejects(invokeBefore(f.context, { ...f.dependencies, environment: { ...environment, CSC_NAME: 'Developer ID Application: Foreign (ZZZZZZZZZZ)' } }), /identity|Team|credentials/u);
	assert.equal(f.calls.length, 0);
});

test('Motion signed afterPack requires its same-process stage authority and refuses later stage or package drift', async t => {
	const f = await fixture(t); await invokeBefore(f.context, f.dependencies); assert.equal(f.calls.filter(call => call.args[0] === '--force').length, 1);
	await packageResources(f);
	await assert.rejects(invokeAfter({ ...f.context, packager: { ...f.context.packager } }, f.dependencies), /authority|signing/u);
	await assert.rejects(invokeAfter({ ...f.context, packager: { ...f.context.packager } }, { ...f.dependencies, environment: { SCAPE_MAC_SIGNING: 'false' } }), /authority|signing/u);
	const packagedHelper = join(f.resources, f.payload.helper!.path); await chmod(packagedHelper, 0o755); await writeFile(packagedHelper, 'modified packaged helper');
	await assert.rejects(invokeAfter(f.context, f.dependencies), /changed|differ|signing|inventory/u);
	await invokeBefore(f.context, f.dependencies).then(() => assert.fail('a signed stage must not be reused'), () => undefined);
});

test('Motion signed authority rejects coherent stage and package repinning by a later actor', async t => {
	const f = await fixture(t); await invokeBefore(f.context, f.dependencies);
	assert.equal(f.calls.filter(call => call.args[0] === '--force').length, 1); await packageResources(f);
	const replacement = 'identical unauthorized staged and packaged renderer';
	await writeFile(join(f.stage, 'renderer/index.html'), replacement); await writeFile(join(f.resources, 'renderer/index.html'), replacement);
	const stage: unknown = await json(f.stagePath); assert.ok(stage && typeof stage === 'object');
	Reflect.set(stage, 'files', await createMotionscaperStageInventory(f.stage)); await writeFile(f.stagePath, `${JSON.stringify(stage, null, '\t')}\n`);
	const reverified = await verifyMotionscaperDesktopStage(f.stage, f.target); await verifyMotionscaperPackagedResources(f.resources, reverified);
	await assert.rejects(invokeAfter(f.context, { ...f.dependencies, environment: { SCAPE_MAC_SIGNING: 'false' } }), /authority|signing|changed/u);
});

for (const platform of ['darwin', 'linux', 'win32'] as const) test(`Motion ${platform} preserves its helper when Mac signing does not apply`, async t => {
	const f = await fixture(t, platform), before = await readFile(f.payloadPath), stageBefore = await readFile(f.stagePath);
	// Non-Mac targets must ignore a Mac flag even without Mac-only credentials.
	await invokeBefore(f.context, { ...f.dependencies, environment: { SCAPE_MAC_SIGNING: platform === 'darwin' ? 'false' : 'true' } });
	assert.equal(f.calls.length, 0); assert.deepEqual(await readFile(f.payloadPath), before);
	assert.deepEqual(await readFile(f.helper), f.binary); assert.deepEqual(await readFile(f.stagePath), stageBefore);
	await verifyMotionscaperDesktopStage(f.stage, f.target);
});

interface CompileTuple { target: nativeContract.MotionNativePayloadTarget; byteLength: number; sha256: string; receiptSha256: string }
function assertCompile(payload: nativeContract.MotionNativePayloadManifest, expected: CompileTuple): void {
	nativeContract.assertMotionscaperNativeCompileProvenance(payload, expected);
}
function signedWire(f: Awaited<ReturnType<typeof fixture>>) {
	const signed = { byteLength: f.binary.length + SIGNATURE.length, sha256: digest(Buffer.concat([f.binary, SIGNATURE])) };
	const proof: SigningProof = { schemaVersion: 1, kind: 'developer-id', teamId: 'ABCDEFGHIJ',
		original: { byteLength: f.binary.length, sha256: digest(f.binary), receiptSha256: f.payload.helper!.receiptSha256 }, signed };
	return { ...f.payload, helper: { ...f.payload.helper!, ...signed }, signing: proof };
}

test('release provenance preserves exact unsigned compile size, digest, target and receipt', async t => {
	const f = await fixture(t), payload = nativeContract.parseMotionscaperNativePayload(await json(f.payloadPath));
	const original: CompileTuple = { target: f.payload.target, byteLength: f.binary.length, sha256: digest(f.binary), receiptSha256: f.payload.helper!.receiptSha256 };
	assertCompile(payload, original);
	for (const changed of [{ byteLength: original.byteLength + 1 }, { sha256: 'b'.repeat(64) }, { receiptSha256: 'c'.repeat(64) }, { target: 'linux-x64' as const }]) {
		assert.throws(() => assertCompile(payload, { ...original, ...changed }), /provenance|identity|compile/u);
	}
});

test('release provenance admits only the explicit signed-Mac derivative of the original compile tuple', async t => {
	const f = await fixture(t), wire = signedWire(f), payload = nativeContract.parseMotionscaperNativePayload(wire);
	const original: CompileTuple = { target: 'mac-arm64', ...wire.signing.original }; assertCompile(payload, original);
	for (const changed of [{ byteLength: original.byteLength + 1 }, { sha256: 'b'.repeat(64) }, { receiptSha256: 'c'.repeat(64) }]) {
		assert.throws(() => assertCompile(payload, { ...original, ...changed }), /provenance|identity|compile/u);
	}
});

test('signed native payload proof is closed and bound to its exact helper and original receipt', async t => {
	const f = await fixture(t), wire = signedWire(f);
	const malformed: unknown[] = [
		{ ...wire, target: 'linux-x64' }, { ...wire, helper: null },
		{ ...wire, signing: { ...wire.signing, unexpected: true } },
		{ ...wire, signing: { ...wire.signing, teamId: 'wrong' } },
		{ ...wire, signing: { ...wire.signing, original: { ...wire.signing.original, extra: true } } },
		{ ...wire, signing: { ...wire.signing, original: { ...wire.signing.original, receiptSha256: 'c'.repeat(64) } } },
		{ ...wire, signing: { ...wire.signing, signed: { ...wire.signing.signed, extra: true } } },
		{ ...wire, signing: { ...wire.signing, signed: { ...wire.signing.signed, byteLength: wire.helper.byteLength + 1 } } },
		{ ...wire, signing: { ...wire.signing, signed: { ...wire.signing.signed, sha256: 'd'.repeat(64) } } },
	];
	for (const input of malformed) assert.throws(() => nativeContract.parseMotionscaperNativePayload(input), /signing|native payload/u);
});

interface ReleaseVerification { resourcesRoot: string; payload: unknown; originalPath: string; compile: CompileTuple }
async function verifyRelease(input: ReleaseVerification, dependencies: Dependencies): Promise<void> {
	await signingOwner.verifyMotionNativeReleaseSigning(input, dependencies);
}
function releaseInput(f: Awaited<ReturnType<typeof fixture>>, payload: unknown): ReleaseVerification {
	return { resourcesRoot: f.resources, payload, originalPath: f.original,
		compile: { target: f.payload.target, byteLength: f.binary.length, sha256: digest(f.binary), receiptSha256: f.payload.helper!.receiptSha256 } };
}

test('native target qualifier independently verifies the packaged derivative without signing credentials', async t => {
	const f = await fixture(t); await invokeBefore(f.context, f.dependencies); await packageResources(f);
	const callsBefore = f.calls.length;
	await verifyRelease(releaseInput(f, await json(f.payloadPath)), { ...f.dependencies, environment: { APPLE_TEAM_ID: environment.APPLE_TEAM_ID, SCAPE_MAC_SIGNING: 'false' } });
	assert.equal(f.calls.slice(callsBefore).filter(call => call.args[0] === '--verify').length, 1);
	assert.equal(f.calls.slice(callsBefore).filter(call => call.args[0] === '--force').length, 0);
	assert.deepEqual(await readFile(f.original), f.binary);
});

test('native target qualifier rejects a self-consistent forged signed proof with different executable content', async t => {
	const f = await fixture(t), wire = signedWire(f), forged = Buffer.concat([f.binary, SIGNATURE]); forged[16] = forged[16]! ^ 1;
	wire.helper.sha256 = digest(forged); wire.signing.signed.sha256 = digest(forged);
	await chmod(f.helper, 0o755); await writeFile(f.helper, forged); await chmod(f.helper, 0o555);
	await writeFile(f.payloadPath, JSON.stringify(wire)); await packageResources(f);
	await assert.rejects(verifyRelease(releaseInput(f, wire), f.dependencies), /content/u);
	assert.deepEqual(await readFile(f.original), f.binary);
});

test('native target qualifier rejects wrong configured Team and mismatched compile authority', async t => {
	const f = await fixture(t); await invokeBefore(f.context, f.dependencies); await packageResources(f);
	const input = releaseInput(f, await json(f.payloadPath));
	await assert.rejects(verifyRelease(input, { ...f.dependencies, environment: { APPLE_TEAM_ID: 'ZZZZZZZZZZ' } }), /Team|signing/u);
	for (const changed of [{ receiptSha256: 'c'.repeat(64) }, { sha256: 'd'.repeat(64) }, { byteLength: input.compile.byteLength + 1 }]) {
		await assert.rejects(verifyRelease({ ...input, compile: { ...input.compile, ...changed } }, f.dependencies), /compile|provenance|identity/u);
	}
});

test('native target qualifier requires a proof for credentialed Mac and leaves other target bytes unchanged', async t => {
	for (const platform of ['darwin', 'linux', 'win32'] as const) {
		const f = await fixture(t, platform); await packageResources(f); const input = releaseInput(f, f.payload);
		if (platform === 'darwin') await assert.rejects(verifyRelease(input, f.dependencies), /signing|proof/u);
		else await verifyRelease(input, f.dependencies);
		assert.equal(f.calls.length, 0); assert.deepEqual(await readFile(f.original), f.binary);
	}
});
