/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { isLocalDesktopVolume } from './local-storage-volume.ts';

interface StorageProbe {
	readonly environment?: NodeJS.ProcessEnv;
	readonly homePath?: string;
	readonly volumeIsLocal?: (path: string) => boolean;
}

const STORAGE_ERROR = 'Working databases require local, unsynced storage. Choose a local temporary data folder; save project archives separately for cloud sync or network sharing.';
const SYNC_COMPONENT = /^(?:onedrive(?:[ -].*)?|dropbox(?:[ (].*)?|google drive|googledrive(?:-.*)?|icloud(?:drive| drive)?|nextcloud|owncloud)$/iu;

/** Check both the selected spelling and its existing physical ancestors before any writes. */
export function assertLocalDesktopStorage(path: string, probe: StorageProbe = {}): void {
	if (/^(?:\\\\|\/\/)/u.test(path)) throw new Error(STORAGE_ERROR);
	if (typeof path !== 'string' || path.includes('\0') || !isAbsolute(path)) {
		throw new TypeError('Working database storage requires an absolute filesystem path.');
	}
	const selected = resolve(path);
	const ancestor = existingAncestor(selected);
	const physical = resolve(ancestor.physical, relative(ancestor.path, selected));
	const roots = synchronizedRoots(probe.environment ?? process.env, probe.homePath ?? homedir());
	for (const candidate of [selected, physical]) {
		const components = candidate.split(/[/\\]/u);
		if (components.some(component => SYNC_COMPONENT.test(component))
			|| /[/\\]Library[/\\](?:CloudStorage|Mobile Documents)(?:[/\\]|$)/iu.test(candidate)
			|| roots.some(root => within(root, candidate))) throw new Error(STORAGE_ERROR);
	}
	if (!(probe.volumeIsLocal ?? isLocalDesktopVolume)(ancestor.physical)) throw new Error(STORAGE_ERROR);
}

function existingAncestor(path: string): { path: string; physical: string } {
	let current = path;
	while (true) {
		try { return { path: current, physical: realpathSync(current) }; }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(current) === current) throw error;
			current = dirname(current);
		}
	}
}

function synchronizedRoots(environment: NodeJS.ProcessEnv, home: string): string[] {
	const roots = [environment.OneDrive, environment.OneDriveConsumer, environment.OneDriveCommercial]
		.filter((path): path is string => typeof path === 'string' && isAbsolute(path));
	// Dropbox permits arbitrary root names; its local registration identifies them.
	for (const config of [join(home, '.dropbox', 'info.json'),
		...[environment.APPDATA, environment.LOCALAPPDATA].filter((path): path is string => !!path)
			.map(path => join(path, 'Dropbox', 'info.json'))]) {
		try {
			const data: unknown = JSON.parse(readFileSync(config, 'utf8'));
			if (data && typeof data === 'object') {
				for (const account of Object.values(data)) {
					if (account && typeof account === 'object' && 'path' in account
					&& typeof account.path === 'string' && isAbsolute(account.path)) roots.push(account.path);
				}
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
	}
	return roots.flatMap(root => {
		const ancestor = existingAncestor(root);
		return [resolve(root), resolve(ancestor.physical, relative(ancestor.path, resolve(root)))];
	});
}

function within(root: string, path: string): boolean {
	const child = relative(root, path);
	return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`));
}
