/* SPDX-License-Identifier: AGPL-3.0-only */
import { constants } from 'node:fs';
import { access, open, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { authenticatePluginCandidate } from './plugin-candidate-authentication.mjs';
import { createExternalFfmpegNodeRunner } from './external-ffmpeg-node-runtime.ts';
import { parseWineVersion, type ExternalWineInstallation } from './external-wine.ts';
import type { NativeChildIsolationArtifactDescriptor } from './native-child-isolation-contract.ts';

/** Find an exact-version ELF server, rather than exempting a process by its name. */
export async function resolveWineServer(wine: Readonly<ExternalWineInstallation>): Promise<NativeChildIsolationArtifactDescriptor> {
	if (wine.state !== 'ready' || !wine.location || !wine.version) throw new Error('Wine is unavailable.');
	const directory = dirname(wine.location);
	const candidates = [join(directory, 'wineserver64'), join(directory, 'wineserver'),
		join(directory, '../lib/wine/wineserver64'), '/usr/lib/wine/wineserver64', '/usr/lib/wine/wineserver',
		'/opt/wine-staging/bin/wineserver', '/opt/wine-devel/bin/wineserver', '/opt/wine-stable/bin/wineserver'];
	const runner = createExternalFfmpegNodeRunner({ workingDirectory: tmpdir() });
	const seen = new Set<string>();
	for (const candidate of candidates) {
		try {
			const path = await realpath(candidate);
			if (seen.has(path)) continue;
			seen.add(path); await access(path, constants.X_OK);
			const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
			try {
				const metadata = await handle.stat(); const header = Buffer.alloc(64);
				if (!metadata.isFile() || metadata.size > 256 * 1024 ** 2) continue;
				const { bytesRead } = await handle.read(header, 0, header.length, 0);
				if (bytesRead !== 64 || header.toString('binary', 0, 4) !== '\x7fELF'
					|| header[4] !== 2 || header[5] !== 1 || header.readUInt16LE(18) !== 62) continue;
			} finally { await handle.close(); }
			const before = await authenticatePluginCandidate(path);
			const result = await runner.run({ executablePath: path, arguments: ['--version'], shell: false,
				standardInput: 'ignore', maximumDurationMs: 5000, maximumOutputBytes: 64 * 1024 });
			if (result.status !== 'exited' || result.exitCode !== 0
				|| parseWineVersion((result.stdout || result.stderr).replace(/^Wine /u, 'wine-'))?.join('.') !== wine.version) continue;
			const after = await authenticatePluginCandidate(path);
			if (after.sha256 !== before.sha256 || after.byteLength !== before.byteLength
				|| String(after.identity.dev) !== String(before.identity.dev) || String(after.identity.ino) !== String(before.identity.ino)) continue;
			return Object.freeze({ path, byteLength: after.byteLength, sha256: after.sha256, identity: after.identity });
		} catch { /* A bad candidate does not displace another exact-version server. */ }
	}
	throw new Error('Wine has no matching native wineserver executable; select a complete Wine installation.');
}

/** Wine maps these distribution-owned images when starting prefix-wide services.
 * Their exact file identities, rather than process names, exempt shared services. */
export async function resolveWineSharedServices(wine: Readonly<ExternalWineInstallation>): Promise<readonly NativeChildIsolationArtifactDescriptor[]> {
	if (!wine.location) throw new Error('Wine is unavailable.');
	const directory = dirname(wine.location);
	const roots = [join(directory, '../lib/wine/x86_64-windows'), join(directory, '../lib64/wine/x86_64-windows'),
		join(directory, '../x86_64-linux-gnu/wine/x86_64-windows'), join(directory, 'x86_64-windows'),
		'/usr/lib/x86_64-linux-gnu/wine/x86_64-windows', '/usr/lib64/wine/x86_64-windows', '/usr/lib/wine/x86_64-windows'];
	const names = ['wineboot.exe', 'services.exe', 'winedevice.exe', 'explorer.exe', 'rpcss.exe', 'plugplay.exe', 'svchost.exe', 'rundll32.exe'];
	for (const root of roots) {
		const services: NativeChildIsolationArtifactDescriptor[] = [];
		for (const name of names) {
			try {
				const path = await realpath(join(root, name));
				const candidate = await authenticatePluginCandidate(path);
				if (candidate.kind !== 'file' || candidate.byteLength > 128 * 1024 ** 2) continue;
				services.push({ path, byteLength: candidate.byteLength, sha256: candidate.sha256, identity: candidate.identity });
			} catch { /* Wine versions differ in their builtin service inventory. */ }
		}
		if (['wineboot.exe', 'services.exe'].every((name) => services.some(({ path }) => path.endsWith(`/${name}`)))) return services;
	}
	throw new Error('Wine builtin services are unavailable; select a complete Wine installation.');
}
