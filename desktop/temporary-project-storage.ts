/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, readFile, rename, writeFile, access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { checkDesktopStorageMigrationDestination, migrateDesktopStorageEntries } from './desktop-storage-migration.ts';
import { assertLocalDesktopStorage } from './local-storage-safety.ts';

export class TemporaryProjectStorageUnavailableError extends Error {
	constructor() {
		super('Reconnect the selected temporary data folder to finish moving the project library, then start the app again.');
		this.name = 'TemporaryProjectStorageUnavailableError';
	}
}

export class TemporaryProjectStorage {
	#active: string;
	#selected: string;
	#moveStarted = false;
	#selectionTail = Promise.resolve();
	constructor(readonly configurationPath: string, readonly defaultRoot: string, readonly appName: string) {
		this.#active = this.#selected = defaultRoot;
	}
	async prepare(): Promise<string> {
		try {
			const value: unknown = JSON.parse(await readFile(this.configurationPath, 'utf8'));
			if (value && typeof value === 'object' && 'active' in value && 'selected' in value) {
				this.#active = folder(value.active); this.#selected = folder(value.selected);
				// An older pending selection may already have moved some files.
				this.#moveStarted = this.#active !== this.#selected
					&& (!('moveStarted' in value) || value.moveStarted !== false);
			}
		} catch (error) { if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
		const active = assertLocalDesktopStorage(this.#active);
		if (this.#active !== this.#selected) {
			const selected = await availableMigrationFolder(this.#selected);
			if (selected === null) {
				if (this.#moveStarted) throw new TemporaryProjectStorageUnavailableError();
				return this.#active;
			}
			await migrateDesktopStorageEntries([{
				source: join(active, this.appName, 'project-library', 'v1'),
				destination: join(selected, this.appName, 'project-library', 'v1'),
			}], { beforeMove: async () => {
				if (this.#moveStarted) return;
				await this.#persist(this.#active, this.#selected, true);
				this.#moveStarted = true;
			} });
			await this.#persist(this.#selected, this.#selected, false);
			this.#active = this.#selected;
			this.#moveStarted = false;
		}
		return this.#active;
	}
	status(): Readonly<{ folder: string; selectedFolder: string; restartRequired: boolean }> {
		return { folder: this.#active, selectedFolder: this.#selected, restartRequired: this.#active !== this.#selected };
	}
	select(path: string): Promise<ReturnType<TemporaryProjectStorage['status']>> {
		const selection = this.#selectionTail.then(() => this.#select(path));
		this.#selectionTail = selection.then(() => undefined, () => undefined);
		return selection;
	}
	async #select(path: string): Promise<ReturnType<TemporaryProjectStorage['status']>> {
		const selected = assertLocalDesktopStorage(folder(path));
		const source = join(assertLocalDesktopStorage(this.#active), this.appName, 'project-library', 'v1');
		const destination = join(selected, this.appName, 'project-library', 'v1');
		await checkDesktopStorageMigrationDestination({ source, destination });
		await mkdir(selected, { recursive: true, mode: 0o700 });
		await access(selected, constants.W_OK);
		await this.#persist(this.#active, selected, false);
		this.#selected = selected;
		this.#moveStarted = false;
		return this.status();
	}
	async #persist(active: string, selected: string, moveStarted: boolean): Promise<void> {
		await mkdir(dirname(this.configurationPath), { recursive: true, mode: 0o700 });
		const temporary = `${this.configurationPath}.tmp`;
		await writeFile(temporary, JSON.stringify({ active, selected, moveStarted }), { mode: 0o600, flush: true });
		await rename(temporary, this.configurationPath);
	}
}
async function availableMigrationFolder(path: string): Promise<string | null> {
	try {
		const selected = assertLocalDesktopStorage(path);
		return (await stat(selected)).isDirectory() ? selected : null;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === 'ENOENT' || code === 'ENOTDIR') return null;
		throw error;
	}
}
function folder(value: unknown): string {
	if (typeof value !== 'string' || value.length > 4096 || value.includes('\0') || !isAbsolute(value)) throw new TypeError('Temporary data folder must be an absolute directory.');
	return resolve(value);
}
