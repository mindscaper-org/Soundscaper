/* SPDX-License-Identifier: AGPL-3.0-only */
import { execFile } from 'node:child_process';
import { chmod, copyFile, lstat, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { assertMotionscaperNativeCompileProvenance, loadMotionscaperNativeExecutable, parseMotionscaperNativePayload, type MotionNativeCompileProvenance, type MotionNativePayloadTarget } from '../../desktop/motionscaper-native-payload.ts';
import { canonicalSigningJson, signingDigest } from './desktop-signing-pins.mjs';
import { createMotionscaperStageInventory, verifyMotionscaperDesktopStage } from './motionscaper-desktop-package.mjs';

export interface MotionSigningContext {
	readonly electronPlatformName: string;
	readonly packager: { readonly projectDir: string };
}
export interface MotionSigningDependencies {
	readonly environment?: NodeJS.ProcessEnv;
	readonly executeFile?: (command: string, args: readonly string[]) => Promise<unknown>;
}
interface Pin { readonly path: string; readonly byteLength: number; readonly sha256: string }
interface Stage { readonly files: readonly Pin[]; readonly [name: string]: unknown }
interface Authority { readonly root: string; readonly target: MotionNativePayloadTarget; readonly stageSha256: string }
const execute = promisify(execFile);
const boundedExecute: NonNullable<MotionSigningDependencies['executeFile']> = (command, args) => execute(command, args, { timeout: 60_000, maxBuffer: 1024 * 1024 });
const signedStages = new WeakMap<object, Authority>();
const PAYLOAD = 'app/desktop/native-payload.json';

/** The caller has already authenticated the unsigned Motion stage, without any AI runtime closure. */
export async function signVerifiedMotionMacStage(context: MotionSigningContext, dependencies: MotionSigningDependencies = {}): Promise<void> {
	const environment = dependencies.environment ?? process.env;
	const root = resolve(context.packager.projectDir, '.desktop-build');
	const payloadPath = join(root, PAYLOAD), stagePath = join(root, 'stage-manifest.json');
	const payloadBytes = await readFile(payloadPath);
	const payload = parseMotionscaperNativePayload(parseJson(payloadBytes));
	if (signedStages.has(context.packager) || payload.signing) throw new Error('A signed Motion stage must be prepared again before repackaging.');
	if (context.electronPlatformName !== 'darwin' || environment.SCAPE_MAC_SIGNING !== 'true') return;
	const { identity, keychain, team } = credentials(environment);
	if (payload.target !== 'mac-arm64' || !payload.helper) throw new Error('Motion Mac signing requires its admitted native helper.');
	const helper = await loadMotionscaperNativeExecutable(root, payload);
	if (!helper) throw new Error('Motion Mac signing helper is unavailable.');
	const stageBytes = await readFile(stagePath), stage = parseStage(stageBytes);
	const original = await canonicalFile(helper.path, 0o555);
	await verifyMotionscaperDesktopStage(root, payload.target);
	await sameFile(stagePath, stageBytes); await sameFile(payloadPath, payloadBytes); await sameFile(helper.path, original);
	// A sibling directory guarantees that final renames remain on the stage filesystem.
	const temporary = await mkdtemp(join(root, '.motion-signing-'));
	let failure: unknown;
	try {
		const signedPath = join(temporary, 'signed-helper');
		await copyFile(helper.path, signedPath); await chmod(signedPath, 0o755);
		if (!(await canonicalFile(signedPath)).equals(original)) throw new Error('Motion helper changed before signing.');
		const executeFile = dependencies.executeFile ?? boundedExecute;
		await executeFile('codesign', ['--force', '--sign', identity, '--keychain', keychain,
			'--options', 'runtime', '--preserve-metadata=entitlements', '--timestamp', signedPath]);
		await executeFile('codesign', ['--verify', '--strict', '--test-requirement',
			developerIdRequirement(team), signedPath]);
		const signed = await canonicalFile(signedPath);
		await executableEquivalence(temporary, original, signed, executeFile);
		// Tools may not authorize unrelated source, manifest or staged-resource drift.
		await sameFile(stagePath, stageBytes); await sameFile(payloadPath, payloadBytes); await sameFile(helper.path, original);
		await verifyMotionscaperDesktopStage(root, payload.target);
		const derivative = parseMotionscaperNativePayload({ ...payload,
			helper: { ...payload.helper, byteLength: signed.length, sha256: signingDigest(signed) },
			signing: { schemaVersion: 1, kind: 'developer-id', teamId: team,
				original: { byteLength: original.length, sha256: signingDigest(original), receiptSha256: payload.helper.receiptSha256 },
				signed: { byteLength: signed.length, sha256: signingDigest(signed) } } });
		const derivativeBytes = canonicalSigningJson(derivative);
		const replacementPins = new Map<string, Pin>([
			[payload.helper.path, { path: payload.helper.path, byteLength: signed.length, sha256: signingDigest(signed) }],
			[PAYLOAD, { path: PAYLOAD, byteLength: derivativeBytes.length, sha256: signingDigest(derivativeBytes) }],
		]);
		const expectedFiles = stage.files.map(pin => replacementPins.get(pin.path) ?? pin);
		await chmod(signedPath, 0o555); await canonicalFile(signedPath, 0o555);
		await rename(signedPath, helper.path);
		await publishJson(temporary, 'payload.json', payloadPath, derivativeBytes);
		const actualFiles: unknown = await createMotionscaperStageInventory(root);
		if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) throw new Error('Motion signing changed unrelated stage inventory.');
		const signedStageBytes = canonicalSigningJson({ ...stage, files: expectedFiles });
		await publishJson(temporary, 'stage.json', stagePath, signedStageBytes);
		await verifyMotionscaperDesktopStage(root, payload.target);
		await sameFile(stagePath, signedStageBytes);
		signedStages.set(context.packager, { root, target: payload.target, stageSha256: signingDigest(signedStageBytes) });
	} catch (error) {
		signedStages.delete(context.packager); failure = error; throw error;
	} finally {
		await cleanupTemporary(temporary, failure, 'Motion signing and temporary cleanup failed.', context.packager);
	}
}

export interface MotionNativeReleaseVerification {
	readonly resourcesRoot: string; readonly payload: unknown; readonly originalPath: string;
	readonly compile: MotionNativeCompileProvenance;
}
/** The native target producer verifies real packaged bytes before its trusted CI receipt is issued. */
export async function verifyMotionNativeReleaseSigning(input: MotionNativeReleaseVerification, dependencies: MotionSigningDependencies = {}): Promise<void> {
	const payload = parseMotionscaperNativePayload(input.payload);
	assertMotionscaperNativeCompileProvenance(payload, input.compile);
	const helper = await loadMotionscaperNativeExecutable(input.resourcesRoot, payload);
	if (!helper) throw new Error('Motion native release helper is unavailable.');
	const original = await canonicalFile(input.originalPath);
	if (original.length !== input.compile.byteLength || signingDigest(original) !== input.compile.sha256) throw new Error('Motion native compile provenance bytes changed.');
	const environment = dependencies.environment ?? process.env;
	if (!payload.signing) {
		if (payload.target === 'mac-arm64' && environment.SCAPE_MAC_SIGNING === 'true') throw new Error('Motion signed Mac release requires its signing proof.');
		return;
	}
	const team = environment.APPLE_TEAM_ID;
	if (!team || !/^[A-Z0-9]{10}$/u.test(team) || team !== payload.signing.teamId) throw new Error('Motion native release signing Team is invalid.');
	const signed = await canonicalFile(helper.path);
	const executeFile = dependencies.executeFile ?? boundedExecute;
	await executeFile('codesign', ['--verify', '--strict', '--test-requirement', developerIdRequirement(team), helper.path]);
	// Verification never strips or writes either packaged or genuine compile input.
	const temporary = await mkdtemp(join(tmpdir(), 'motionscaper-release-signing-'));
	let failure: unknown;
	try {
		await executableEquivalence(temporary, original, signed, executeFile);
		await sameFile(input.originalPath, original); await sameFile(helper.path, signed);
		await loadMotionscaperNativeExecutable(input.resourcesRoot, payload);
	} catch (error) {
		failure = error; throw error;
	} finally {
		await cleanupTemporary(temporary, failure, 'Motion release signing verification and cleanup failed.');
	}
}

async function cleanupTemporary(path: string, failure: unknown, message: string, packager?: object): Promise<void> {
	try { await rm(path, { recursive: true, force: true }); }
	catch (cleanup) {
		if (packager) signedStages.delete(packager);
		if (failure) throw new AggregateError([failure, cleanup], message, { cause: cleanup });
		throw cleanup;
	}
}

/** Parsed signing proof alone never grants authority to repin or package a signed stage. */
export async function assertMotionMacSigningAuthority(context: MotionSigningContext, dependencies: MotionSigningDependencies = {}): Promise<void> {
	const root = resolve(context.packager.projectDir, '.desktop-build');
	const payload = parseMotionscaperNativePayload(parseJson(await readFile(join(root, PAYLOAD))));
	const authority = signedStages.get(context.packager);
	const required = context.electronPlatformName === 'darwin' && (dependencies.environment ?? process.env).SCAPE_MAC_SIGNING === 'true';
	if (!payload.signing && !authority && !required) return;
	if (!payload.signing || !authority || authority.root !== root || authority.target !== payload.target
		|| signingDigest(await canonicalFile(join(root, 'stage-manifest.json'))) !== authority.stageSha256) {
		throw new Error('Motion Mac signing-stage authority is missing or changed.');
	}
}
function developerIdRequirement(team: string): string {
	return `anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${team}"`;
}
function credentials(environment: NodeJS.ProcessEnv): { identity: string; keychain: string; team: string } {
	const identity = environment.CSC_NAME, keychain = environment.CSC_KEYCHAIN, team = environment.APPLE_TEAM_ID;
	if (!identity?.startsWith('Developer ID Application: ') || !keychain?.trim() || !/^[A-Z0-9]{10}$/u.test(team ?? '')
		|| !identity.endsWith(`(${team})`)) throw new Error('Motion Mac signing credentials, Developer ID identity or Team are invalid.');
	return { identity, keychain, team: team! };
}
async function executableEquivalence(temporary: string, original: Buffer, signed: Buffer,
	executeFile: NonNullable<MotionSigningDependencies['executeFile']>): Promise<void> {
	const originalPath = join(temporary, 'unsigned-comparison'), signedPath = join(temporary, 'signed-comparison');
	await writeFile(originalPath, original, { flag: 'wx', mode: 0o600 }); await writeFile(signedPath, signed, { flag: 'wx', mode: 0o600 });
	try { await executeFile('codesign', ['--remove-signature', originalPath]); }
	catch (error) {
		if (!error || typeof error !== 'object' || !String(Reflect.get(error, 'stderr')).includes('code object is not signed at all')) throw error;
	}
	await executeFile('codesign', ['--remove-signature', signedPath]);
	if (!(await canonicalFile(originalPath)).equals(await canonicalFile(signedPath))) throw new Error('Motion signing changed executable content.');
}
async function canonicalFile(path: string, mode?: number): Promise<Buffer> {
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || await realpath(path) !== path
		|| (mode !== undefined && (before.mode & 0o777) !== mode) || before.size < 1 || before.size > 256 * 1024 * 1024) {
		throw new Error('Motion signing input is not its bounded canonical file.');
	}
	const bytes = await readFile(path), after = await lstat(path);
	if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size
		|| before.ctimeMs !== after.ctimeMs || before.mtimeMs !== after.mtimeMs) throw new Error('Motion signing input changed while reading.');
	return bytes;
}
async function sameFile(path: string, bytes: Buffer): Promise<void> {
	if (!(await canonicalFile(path)).equals(bytes)) throw new Error('Motion signing stage input changed.');
}
async function publishJson(temporary: string, name: string, destination: string, bytes: Buffer): Promise<void> {
	const path = join(temporary, name); await writeFile(path, bytes, { flag: 'wx', mode: 0o644 });
	await canonicalFile(path); await rename(path, destination);
}
function parseJson(bytes: Buffer): unknown { return JSON.parse(bytes.toString('utf8')) as unknown; }
function parseStage(bytes: Buffer): Stage {
	const value = parseJson(bytes);
	if (!value || typeof value !== 'object' || !Array.isArray(Reflect.get(value, 'files'))) throw new Error('Motion signing stage inventory is unavailable.');
	return value as Stage;
}
