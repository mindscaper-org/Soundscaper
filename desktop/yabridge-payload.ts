/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { constants } from 'node:fs';
import { nativeChildFileIdentityFromStat } from './native-child-file-identity.ts';
import type { NativeChildIsolationArtifactDescriptor } from './native-child-isolation-contract.ts';

export const YABRIDGE_RUNTIME_PREFIX = 'native/yabridge/linux-x64';
export const YABRIDGE_EXECUTABLE_FILES = Object.freeze([
	'libyabridge-vst3.so', 'yabridge-host.exe', 'yabridge-host.exe.so', 'soundscaper-wine-launcher',
]);
export const YABRIDGE_RUNTIME_FILES = Object.freeze([
	...YABRIDGE_EXECUTABLE_FILES, 'COPYING', 'SOURCE.json', 'corresponding-source.tar.gz',
]);

export async function authenticateYabridgePayload(manifest: unknown, runtimeRoot: string): Promise<Readonly<{
	version: string; directory: string; artifacts: readonly NativeChildIsolationArtifactDescriptor[];
}>> {
	const value = manifest as { schemaVersion?: unknown; target?: unknown; runtimePrefix?: unknown;
		status?: unknown; source?: { version?: unknown; commit?: unknown }; files?: unknown } | null;
	if (value?.schemaVersion !== 1 || value.target !== 'linux-x64' || value.runtimePrefix !== YABRIDGE_RUNTIME_PREFIX
		|| value.status !== 'built' || typeof value.source?.version !== 'string'
		|| !/^[a-f0-9]{40}$/u.test(String(value.source.commit)) || !Array.isArray(value.files)
		|| value.files.length < YABRIDGE_RUNTIME_FILES.length || value.files.length > 128 || !isAbsolute(runtimeRoot)) {
		throw new Error('The bundled yabridge manifest is unavailable or malformed.');
	}
	const directory = resolve(runtimeRoot, YABRIDGE_RUNTIME_PREFIX);
	if (await realpath(directory) !== directory) throw new Error('The yabridge runtime must have a canonical path.');
	const expected = new Set<string>();
	const artifacts: NativeChildIsolationArtifactDescriptor[] = [];
	for (const entry of value.files as { path?: unknown; byteLength?: unknown; sha256?: unknown }[]) {
		if (typeof entry.path !== 'string' || !/^[a-zA-Z0-9_.-]+$/u.test(entry.path) || entry.path.startsWith('.')
			|| expected.has(entry.path) || !Number.isSafeInteger(entry.byteLength) || Number(entry.byteLength) < 1
			|| Number(entry.byteLength) > 128 * 1024 ** 2 || !/^[a-f0-9]{64}$/u.test(String(entry.sha256))) {
			throw new Error('The yabridge file inventory is malformed.');
		}
		expected.add(entry.path);
		const path = join(directory, entry.path);
		const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const before = await handle.stat({ bigint: true });
			if (!before.isFile() || before.size !== BigInt(Number(entry.byteLength))) throw new Error('The yabridge file changed.');
			const bytes = await handle.readFile();
			if (YABRIDGE_EXECUTABLE_FILES.includes(entry.path) && entry.path !== 'yabridge-host.exe'
				&& (bytes.length < 64 || bytes.toString('binary', 0, 4) !== '\x7fELF'
					|| bytes[4] !== 2 || bytes[5] !== 1 || bytes.readUInt16LE(18) !== 62)) {
				throw new Error('The yabridge payload is not a Linux x64 ELF binary.');
			}
			const after = await lstat(path, { bigint: true });
			if (after.ino !== before.ino || after.dev !== before.dev || after.mtimeNs !== before.mtimeNs
				|| after.ctimeNs !== before.ctimeNs || bytes.byteLength !== Number(entry.byteLength)
				|| createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('The yabridge file changed.');
			artifacts.push(Object.freeze({ path, byteLength: Number(entry.byteLength), sha256: String(entry.sha256),
				identity: nativeChildFileIdentityFromStat(before) }));
		} finally { await handle.close(); }
	}
	if (YABRIDGE_RUNTIME_FILES.some((name) => !expected.has(name))
		|| !(await readdir(directory)).every((name) => expected.has(name))) throw new Error('The yabridge runtime inventory differs.');
	return Object.freeze({ version: value.source.version, directory, artifacts: Object.freeze(artifacts) });
}
