/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, readFile, rename, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { migrateDesktopStorageEntries } from './desktop-storage-migration.ts';
import { assertLocalDesktopStorage } from './local-storage-safety.ts';

export class TemporaryProjectStorage {
	#active: string;
	#selected: string;
	constructor(readonly configurationPath: string, readonly defaultRoot: string, readonly appName: string) {
		this.#active = this.#selected = defaultRoot;
	}
	async prepare(): Promise<string> {
		try {
			const value: unknown = JSON.parse(await readFile(this.configurationPath, 'utf8'));
			if (value && typeof value === 'object' && 'active' in value && 'selected' in value) {
				this.#active = folder(value.active); this.#selected = folder(value.selected);
			}
		} catch (error) { if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
		assertLocalDesktopStorage(this.#active);
		assertLocalDesktopStorage(this.#selected);
		if (this.#active !== this.#selected) {
			await migrateDesktopStorageEntries([{
				source: join(this.#active, this.appName, 'project-library', 'v1'),
				destination: join(this.#selected, this.appName, 'project-library', 'v1'),
			}]);
			await this.#persist(this.#selected, this.#selected);
			this.#active = this.#selected;
		}
		return this.#active;
	}
	status(): Readonly<{ folder: string; selectedFolder: string; restartRequired: boolean }> {
		return { folder: this.#active, selectedFolder: this.#selected, restartRequired: this.#active !== this.#selected };
	}
	async select(path: string): Promise<ReturnType<TemporaryProjectStorage['status']>> {
		const selected = folder(path);
		assertLocalDesktopStorage(selected);
		await mkdir(selected, { recursive: true, mode: 0o700 });
		await access(selected, constants.W_OK);
		await this.#persist(this.#active, selected);
		this.#selected = selected;
		return this.status();
	}
	async #persist(active: string, selected: string): Promise<void> {
		await mkdir(dirname(this.configurationPath), { recursive: true, mode: 0o700 });
		const temporary = `${this.configurationPath}.tmp`;
		await writeFile(temporary, JSON.stringify({ active, selected }), { mode: 0o600 });
		await rename(temporary, this.configurationPath);
	}
}
function folder(value: unknown): string {
	if (typeof value !== 'string' || value.length > 4096 || value.includes('\0') || !isAbsolute(value)) throw new TypeError('Temporary data folder must be an absolute directory.');
	return resolve(value);
}
