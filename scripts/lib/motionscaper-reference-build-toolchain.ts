/* SPDX-License-Identifier: AGPL-3.0-only */
import { inflateSync } from 'node:zlib';
import { posix, win32 } from 'node:path';
import { fingerprintFramescaperMediaHostToolchainReceipt } from '../../native/framescaper-media-host/build/recipe-driver.mjs';
import type { MotionNativeTarget } from './motionscaper-native-source.ts';
import type { MotionReferenceTools } from './motionscaper-reference-build-plan.ts';

export interface MotionReferenceNativeToolchain {
	readonly schemaVersion: 1; readonly targetId: MotionNativeTarget; readonly hostRuntime: string;
	readonly identitySha256: string;
	readonly executables: Readonly<Record<string, { readonly path: string; readonly sha256: string }>>;
	readonly environment: Readonly<Record<string, string>>;
}
const ENVIRONMENT = ['INCLUDE', 'LIB', 'LIBPATH', 'MACOSX_DEPLOYMENT_TARGET', 'PATH', 'SDKROOT', 'SYSTEMROOT'];

/** Full canonical source-owned toolchain evidence, compacted to retain the existing16KiB artifact receipt bound. */
export function readMotionReferenceToolchainAudit(encoded: unknown, target: MotionNativeTarget, expectedIdentity: string): Readonly<{ receipt: MotionReferenceNativeToolchain; bytes: Buffer; tools: MotionReferenceTools }> {
	if (typeof encoded !== 'string' || encoded.length > 16_384 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) throw new Error('Reference compiler toolchain encoding is invalid.');
	const compressed = Buffer.from(encoded, 'base64');
	if (compressed.toString('base64') !== encoded) throw new Error('Reference compiler toolchain encoding is not canonical.');
	const bytes = inflateSync(compressed, { maxOutputLength: 64 * 1024 });
	const input: unknown = JSON.parse(bytes.toString('utf8'));
	const receipt = record(input, ['schemaVersion', 'targetId', 'hostRuntime', 'identitySha256', 'executables', 'environment']);
	const runtime = target === 'mac-arm64' ? 'darwin-arm64' : target.startsWith('win-') ? `win32-${target.slice(4)}` : target;
	if (receipt.schemaVersion !== 1 || receipt.targetId !== target || receipt.hostRuntime !== runtime || receipt.identitySha256 !== expectedIdentity) throw new Error('Reference compiler native toolchain identity differs.');
	const { identitySha256: _identity, ...body } = receipt;
	if (fingerprintFramescaperMediaHostToolchainReceipt(body) !== expectedIdentity) throw new Error('Reference compiler toolchain fingerprint differs from the native build.');
	if (!bytes.equals(Buffer.from(`${JSON.stringify(receipt, null, '\t')}\n`))) throw new Error('Reference compiler toolchain receipt is not canonical.');
	const roles = ['ar', 'c', 'cmake', 'cxx', 'make', 'ninja', 'pkgConfig', 'ranlib', 'shell', ...(target.startsWith('win-') ? ['msbuild', 'rc'] : [])];
	const executables = record(receipt.executables, roles), path = target.startsWith('win-') ? win32 : posix;
	for (const value of Object.values(executables)) {
		const tool = record(value, ['path', 'sha256']);
		if (typeof tool.path !== 'string' || !path.isAbsolute(tool.path) || path.resolve(tool.path) !== tool.path || /[\0\r\n;]/u.test(tool.path)
			|| typeof tool.sha256 !== 'string' || !/^[a-f\d]{64}$/u.test(tool.sha256)) throw new Error('Reference compiler executable pin is invalid.');
	}
	if (!receipt.environment || typeof receipt.environment !== 'object' || Array.isArray(receipt.environment)) throw new Error('Reference compiler environment is invalid.');
	const environment = receipt.environment as Record<string, unknown>;
	if (typeof environment.PATH !== 'string' || !environment.PATH) throw new Error('Reference compiler environment omits PATH.');
	for (const [key, value] of Object.entries(environment)) if (!ENVIRONMENT.includes(key) || typeof value !== 'string' || !value || value.includes('\0')) throw new Error('Reference compiler environment contains an unadmitted value.');
	const accepted = receipt as unknown as MotionReferenceNativeToolchain;
	const used = (role: string) => accepted.executables[role]!.path;
	return { receipt: accepted, bytes, tools: { cmake: used('cmake'), ninja: used('ninja'), c: used('c'), cxx: used('cxx'), pkgConfig: used('pkgConfig'), ...(target.startsWith('win-') ? { rc: used('rc') } : {}) } };
}

function record(input: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(Object.keys(input).sort()) !== JSON.stringify([...keys].sort())) throw new Error('Reference compiler toolchain fields are not closed.');
	return input as Record<string, unknown>;
}
