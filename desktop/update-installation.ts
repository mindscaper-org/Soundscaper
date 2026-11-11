/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DOWNLOAD_ROOT = 'https://github.com/LeoWattenberg/Soundscaper/releases/download/';
const MAX_INSTALLER_BYTES = 8 * 1024 ** 3;
export interface UpdateInstaller {
	readonly version: string;
	readonly name: string;
	readonly url: string;
	readonly size: number;
	readonly sha256: string;
}
interface InstallerTarget {
	readonly productName: string;
	readonly tagPrefix: string;
	readonly version: string;
	readonly platform: string;
	readonly arch: string;
	readonly appImage?: boolean;
}
function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function selectUpdateInstaller(release: unknown, target: InstallerTarget): UpdateInstaller {
	const os = ({ win32: 'win', darwin: 'mac', linux: 'linux' } as Record<string, string>)[target.platform];
	const extension = target.platform === 'win32' ? 'exe' : target.platform === 'darwin' ? 'pkg' : target.appImage ? 'AppImage' : 'deb';
	const name = `${target.productName}-${target.version}-${os}-${target.arch}.${extension}`;
	const value = record(release);
	const matches = (Array.isArray(value.assets) ? value.assets : []).map(record).filter(asset => asset.name === name);
	const asset = matches.length === 1 ? matches[0]! : {};
	if (!os || value.tag_name !== `${target.tagPrefix}${target.version}`
		|| asset.browser_download_url !== `${DOWNLOAD_ROOT}${target.tagPrefix}${target.version}/${name}`
		|| typeof asset.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(asset.digest)) throw new Error('No matching update installer.');
	return validateInstaller({ version: target.version, name, url: asset.browser_download_url,
		size: asset.size, sha256: typeof asset.digest === 'string' ? asset.digest.replace(/^sha256:/u, '') : null });
}
function validateInstaller(value: unknown): UpdateInstaller {
	const item = record(value);
	const match = /^(Soundscaper|Framescaper)-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-(win|mac|linux)-(x64|arm64)\.(exe|pkg|deb|AppImage)$/u.exec(String(item.name));
	if (!match || item.version !== match[2] || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(item.sha256)
		|| typeof item.size !== 'number' || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > MAX_INSTALLER_BYTES
		|| ![`${DOWNLOAD_ROOT}${match[1]!.toLowerCase()}-v${item.version}/${item.name}`,
			...(match[1] === 'Soundscaper' ? [`${DOWNLOAD_ROOT}v${item.version}/${item.name}`] : [])].includes(String(item.url))) {
		throw new Error('Invalid update installer.');
	}
	return Object.freeze({ version: item.version as string, name: item.name as string,
		url: item.url as string, size: item.size, sha256: item.sha256 });
}

interface InstallationOptions {
	readonly root: string;
	readonly currentVersion: string;
	readonly isNewer: (candidate: string, current: string) => boolean;
	readonly accepts?: (installer: UpdateInstaller) => boolean;
	readonly fetchImpl?: typeof fetch;
	readonly openInstaller: (path: string) => Promise<void>;
}
/** Stages only explicitly accepted updates; restart never trusts an unchecked file. */
export class DesktopUpdateInstallation {
	readonly #options: InstallationOptions;
	constructor(options: InstallationOptions) { this.#options = options; }
	async install(value: UpdateInstaller, when: 'now' | 'next-launch'): Promise<void> {
		const installer = this.#admit(value);
		const { root } = this.#options;
		await mkdir(root, { recursive: true, mode: 0o700 });
		const temporary = join(root, `${randomUUID()}.part`);
		const path = join(root, installer.name);
		try {
			const response = await (this.#options.fetchImpl ?? fetch)(installer.url, { signal: AbortSignal.timeout(30 * 60 * 1000) });
			if (!response.ok || !response.body) throw new Error('Could not download update installer.');
			const file = await open(temporary, 'wx', 0o600);
			try {
				let bytes = 0;
				const hash = createHash('sha256');
				for await (const chunk of response.body) {
					bytes += chunk.byteLength;
					if (bytes > installer.size) throw new Error('Update installer exceeds its expected size.');
					hash.update(chunk);
					await file.writeFile(chunk);
				}
				if (bytes !== installer.size || hash.digest('hex') !== installer.sha256) throw new Error('Update installer verification failed.');
				await file.sync();
			} finally { await file.close(); }
			await rename(temporary, path);
			if (when === 'now') {
				await this.#options.openInstaller(path);
				await this.#clearPending();
			} else {
				const pending = join(root, `${randomUUID()}.json`);
				try {
					await writeFile(pending, JSON.stringify(installer), { flag: 'wx', mode: 0o600 });
					await rename(pending, join(root, 'pending.json'));
				} finally { await rm(pending, { force: true }); }
			}
		} finally { await rm(temporary, { force: true }); }
	}
	async installPending(): Promise<boolean> {
		let installer: UpdateInstaller;
		try {
			const metadata = await lstat(join(this.#options.root, 'pending.json'));
			if (!metadata.isFile() || metadata.size > 8192) throw new Error('Invalid pending update installer.');
			installer = this.#admit(JSON.parse(await readFile(join(this.#options.root, 'pending.json'), 'utf8')));
			if (!this.#options.isNewer(installer.version, this.#options.currentVersion)) { await this.#clearPending(); return false; }
			await verifyInstaller(join(this.#options.root, installer.name), installer);
		} catch (error) {
			await this.#clearPending();
			if (record(error).code === 'ENOENT') return false;
			throw error;
		}
		await this.#options.openInstaller(join(this.#options.root, installer.name));
		await this.#clearPending();
		return true;
	}
	#admit(value: unknown): UpdateInstaller {
		const installer = validateInstaller(value);
		if (this.#options.accepts && !this.#options.accepts(installer)) throw new Error('Update installer does not match this application.');
		return installer;
	}
	async #clearPending(): Promise<void> { await rm(join(this.#options.root, 'pending.json'), { force: true }); }
}

async function verifyInstaller(path: string, installer: UpdateInstaller): Promise<void> {
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.size !== installer.size) throw new Error('Update installer verification failed.');
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
	if (hash.digest('hex') !== installer.sha256) throw new Error('Update installer verification failed.');
}

/** Linux can atomically replace a running AppImage; preserve its executable mode. */
export async function replaceUpdateAppImage(installer: string, destination: string): Promise<void> {
	const metadata = await lstat(destination);
	if (!metadata.isFile()) throw new Error('The installed AppImage must be a regular file.');
	const temporary = `${destination}.${randomUUID()}.update`;
	try {
		await copyFile(installer, temporary);
		await chmod(temporary, metadata.mode | 0o100);
		await rename(temporary, destination);
	} finally { await rm(temporary, { force: true }); }
}
