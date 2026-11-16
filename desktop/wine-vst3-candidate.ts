/* SPDX-License-Identifier: AGPL-3.0-only */

/** Map an authenticated Windows installation into a private merged VST3 bundle. */
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, open, realpath, rm, symlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { authenticatePluginCandidate } from './plugin-candidate-authentication.mjs';
import { canonicalNativeChildFileIdentity, nativeChildFileIdentityFromStat } from './native-child-file-identity.ts';
import { windowsPluginArchitecture } from './windows-plugin-architecture.ts';
import type { ProfessionalPluginPeerContext } from './soundscaper-professional-plugin-peer.ts';
import type { HelperPluginFormat } from './helper-job-grant.ts';

export interface WineVst3Context extends ProfessionalPluginPeerContext { readonly linuxWineVst3?: true }

/** Native merged bundles keep their native implementation. No candidate symlinks are followed. */
export async function wineVst3Module(path: string): Promise<string | null> {
	const metadata = await lstat(path);
	if (metadata.isSymbolicLink() || await realpath(path) !== path) throw new Error('A plugin candidate must be canonical.');
	let module = path;
	if (metadata.isDirectory()) {
		const name = basename(path).replace(/\.vst3$/iu, '');
		try {
			if ((await lstat(join(path, 'Contents/x86_64-linux', `${name}.so`))).isFile()) return null;
		} catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
		module = join(path, 'Contents/x86_64-win', `${name}.vst3`);
		try { await lstat(module); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
	}
	const handle = await open(module, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const buffer = Buffer.alloc(65_562);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		if (buffer.toString('ascii', 0, 2) !== 'MZ') return null;
		if (windowsPluginArchitecture(buffer.subarray(0, bytesRead)) !== 'x64') {
			throw new Error('The Wine bridge supports only 64-bit x64 Windows VST3 plugins.');
		}
		if (await realpath(module) !== module) throw new Error('The Windows VST3 module must be canonical.');
		return module;
	} finally { await handle.close(); }
}

export async function prepareWineVst3Bundle(path: string, expected: Pick<ProfessionalPluginPeerContext,
	'identity' | 'byteLength' | 'sha256'>, options: Readonly<{ libraryPath: string; librarySha256?: string; scratchRoot: string }>) {
	const actual = await authenticatePluginCandidate(path);
	const identity = canonicalNativeChildFileIdentity(actual.identity);
	const captured = canonicalNativeChildFileIdentity(expected.identity);
	if (actual.sha256 !== expected.sha256 || actual.byteLength !== expected.byteLength
		|| identity.dev !== captured.dev || identity.ino !== captured.ino) {
		throw new Error('The Windows plugin changed before bridge preparation.');
	}
	const module = await wineVst3Module(path);
	if (!module) throw new Error('The Wine bridge requires a Windows VST3 installation.');
	const root = await mkdtemp(join(options.scratchRoot, 'wine-vst3-'));
	const dispose = () => rm(root, { recursive: true, force: true });
	try {
		const name = basename(path).replace(/\.vst3$/iu, '');
		const bundle = join(root, `${name}.vst3`);
		await mkdir(join(bundle, 'Contents/x86_64-linux'), { recursive: true, mode: 0o700 });
		await mkdir(join(bundle, 'Contents/x86_64-win'), { mode: 0o700 });
		const library = join(bundle, 'Contents/x86_64-linux', `${name}.so`);
		await copyFile(options.libraryPath, library, constants.COPYFILE_EXCL);
		if (options.librarySha256 && (await authenticatePluginCandidate(library)).sha256 !== options.librarySha256) {
			throw new Error('The bundled yabridge library changed while preparing the plugin.');
		}
		await symlink(module, join(bundle, 'Contents/x86_64-win', `${name}.vst3`));
		return Object.freeze({ path: bundle,
			identity: nativeChildFileIdentityFromStat(await lstat(bundle, { bigint: true })), dispose });
	} catch (error) { await dispose(); throw error; }
}

interface RoutablePeer {
	inspectPluginCandidate(path: string, format: HelperPluginFormat, context: WineVst3Context): Promise<unknown>;
	openPluginInstance(path: string, sampleRate: number, maximumFrames: number, format: HelperPluginFormat,
		stableId: string, context: WineVst3Context): Promise<object>;
}

export function createWineVst3Router<T extends RoutablePeer>(options: Readonly<{
	target: string; nativePeer: T; winePeer: RoutablePeer;
}>) {
	if (options.target !== 'linux-x64') throw new Error('Wine VST3 bridging requires Linux x64.');
	const peer = async (path: string, format: HelperPluginFormat, context: WineVst3Context) => {
		if (format !== 'vst3' || !await wineVst3Module(path)) return options.nativePeer;
		if (context.linuxWineVst3 !== true) throw new Error('Windows VST3 hosting requires explicit Wine bridge consent.');
		return options.winePeer;
	};
	return Object.freeze({ ...options.nativePeer,
		inspectPluginCandidate: async (path: string, format: HelperPluginFormat, context: WineVst3Context) =>
			(await peer(path, format, context)).inspectPluginCandidate(path, format, context),
		openPluginInstance: async (path: string, sampleRate: number, maximumFrames: number,
			format: HelperPluginFormat, stableId: string, context: WineVst3Context) =>
			(await peer(path, format, context)).openPluginInstance(path, sampleRate, maximumFrames, format, stableId, context),
	});
}
