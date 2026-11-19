/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rmdir, writeFile, access, lstat, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { clearDesktopStorageCopyStage } from './desktop-storage-copy-stage.ts';
import { checkDesktopStorageMigrationDestination, DesktopStorageMigrationPreflightError, migrateDesktopStorageEntries, sameDesktopStorageDirectory } from './desktop-storage-migration.ts';
import { ProjectLibraryDirectoryInUseError, projectLibraryLocationDirectory, withProjectLibraryRelocation } from './project-library-directory-lock.ts';
import { fixedProjectLibraryPaths } from './project-library-path-layout.ts';
import { assertLocalDesktopStorage, UnsupportedDesktopStorageLocationError } from './local-storage-safety.ts';

const FOLDER_ID = /^[a-f0-9]{32}$/u;
const COPY_STAGE = /^relocation-[a-f0-9]{32}$/u;
type FolderState = Readonly<{
	active: string; selected: string; moveStarted: boolean; activeId?: string | undefined; selectedId?: string | undefined;
	copyStage?: string | undefined;
}>;

export class TemporaryProjectStorageUnavailableError extends Error {
	constructor(folder: 'active' | 'selected') {
		super(folder === 'active' ? 'Reconnect the current temporary data folder, then start the app again.'
			: 'Reconnect the selected temporary data folder or restore write access to finish moving the project library, then start the app again.');
		this.name = 'TemporaryProjectStorageUnavailableError';
	}
}

export class TemporaryProjectStorage {
	#state: FolderState;
	#selectionTail = Promise.resolve();
	constructor(readonly configurationPath: string, readonly defaultRoot: string, readonly appName: string) {
		this.#state = { active: defaultRoot, selected: defaultRoot, moveStarted: false };
	}
	async prepare(onSelectionRefused?: (error: Error) => void): Promise<string> {
		try {
			const value: unknown = JSON.parse(await readFile(this.configurationPath, 'utf8'));
			if (value && typeof value === 'object' && 'active' in value && 'selected' in value) {
				const active = folder(value.active), selected = folder(value.selected);
				// An older pending selection may already have moved some files.
				const moveStarted = active !== selected && (!('moveStarted' in value) || value.moveStarted !== false);
				this.#state = { active, selected, moveStarted,
					activeId: folderId(value, 'activeId'), selectedId: folderId(value, 'selectedId'),
					copyStage: moveStarted ? copyStageName(value) : undefined };
			}
		} catch (error) { if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
		const activeRoot = await this.#openActiveFolder();
		const state = this.#state;
		if (state.active === state.selected) return state.active;
		let selectedRoot: string | null;
		try { selectedRoot = await this.#availableFolder(state.selected, state.selectedId); }
		catch (error) {
			if (state.moveStarted || !(error instanceof UnsupportedDesktopStorageLocationError)) throw error;
			return this.#refuseFolderSelection(error, onSelectionRefused);
		}
		if (selectedRoot === null || !await temporaryFolderIsWritable(selectedRoot)) {
			if (state.moveStarted) throw new TemporaryProjectStorageUnavailableError('selected');
			return state.active;
		}
		if (await this.#sharesCurrentLibraryStorage(activeRoot, selectedRoot)) {
			await this.#cancelAliasedSelection();
			return state.active;
		}
		return withProjectLibraryRelocation([activeRoot, selectedRoot], this.appName, async () => {
			if (state.activeId !== undefined && await this.#availableFolder(state.active, state.activeId) !== activeRoot) {
				throw new TemporaryProjectStorageUnavailableError('active');
			}
			if (state.selectedId !== undefined && await this.#availableFolder(state.selected, state.selectedId) !== selectedRoot) {
				throw new TemporaryProjectStorageUnavailableError('selected');
			}
			let selectedId = state.selectedId;
			const location = projectLibraryLocationDirectory(selectedRoot, this.appName);
			let copyStageDirectory: string | undefined;
			if (state.copyStage !== undefined) {
				await assertCopyStageParent(location);
				copyStageDirectory = join(location, state.copyStage);
			}
			await migrateDesktopStorageEntries([{
				source: this.#libraryPath(activeRoot), destination: this.#libraryPath(selectedRoot),
			}], {
				beforeMove: async () => {
					selectedId ??= await this.#rememberFolder(selectedRoot);
					if (!state.moveStarted || selectedId !== state.selectedId) {
						await this.#persist({ ...state, selectedId, moveStarted: true });
					}
				},
				copyStageDirectory,
				createCopyStage: process.platform === 'linux' ? async () => {
					copyStageDirectory = await this.#createCopyStage(location);
					return copyStageDirectory;
				} : undefined,
			});
			if (copyStageDirectory !== undefined) await clearDesktopStorageCopyStage(copyStageDirectory);
			selectedId ??= await this.#rememberFolder(selectedRoot);
			await this.#persist({ active: state.selected, selected: state.selected, moveStarted: false, activeId: selectedId, selectedId });
			return this.#state.active;
		}).catch((error: unknown) => {
			if (state.moveStarted) throw error;
			if (error instanceof ProjectLibraryDirectoryInUseError && error.root === selectedRoot) return state.active;
			if (!(error instanceof DesktopStorageMigrationPreflightError)) throw error;
			return this.#refuseFolderSelection(error, onSelectionRefused);
		});
	}
	status(): Readonly<{ folder: string; selectedFolder: string; restartRequired: boolean }> {
		const { active, selected } = this.#state;
		return { folder: active, selectedFolder: selected, restartRequired: active !== selected };
	}
	select(path: string): Promise<ReturnType<TemporaryProjectStorage['status']>> {
		const selection = this.#selectionTail.then(() => this.#select(path));
		this.#selectionTail = selection.then(() => undefined, () => undefined);
		return selection;
	}
	async #select(path: string): Promise<ReturnType<TemporaryProjectStorage['status']>> {
		const selected = assertLocalDesktopStorage(folder(path));
		const active = await this.#openActiveFolder();
		if (selected !== active && await this.#sharesCurrentLibraryStorage(active, selected)) {
			await this.#cancelAliasedSelection();
			return this.status();
		}
		await checkDesktopStorageMigrationDestination({ source: this.#libraryPath(active), destination: this.#libraryPath(selected) });
		await mkdir(selected, { recursive: true, mode: 0o700 });
		await access(selected, constants.W_OK);
		const selectedId = active === selected && this.#state.activeId !== undefined
			? this.#state.activeId : await this.#rememberFolder(selected);
		await this.#persist({ ...this.#state, selected, selectedId, moveStarted: false, copyStage: undefined });
		return this.status();
	}
	async #sharesCurrentLibraryStorage(active: string, selected: string): Promise<boolean> {
		return await sameDesktopStorageDirectory(active, selected)
			|| await sameDesktopStorageDirectory(this.#libraryPath(active), this.#libraryPath(selected));
	}
	async #cancelAliasedSelection(): Promise<void> {
		if (this.#state.moveStarted) throw new TemporaryProjectStorageUnavailableError('selected');
		await this.#resetFolderSelection();
	}
	async #refuseFolderSelection(error: Error, report?: (error: Error) => void): Promise<string> {
		await this.#resetFolderSelection();
		report?.(error);
		return this.#state.active;
	}
	async #resetFolderSelection(): Promise<void> {
		const { active, activeId, selected } = this.#state;
		if (active !== selected) await this.#persist({ active, activeId, selected: active, selectedId: activeId, moveStarted: false });
	}
	async #openActiveFolder(): Promise<string> {
		const state = this.#state;
		if (state.activeId === undefined && state.active === resolve(this.defaultRoot)) return assertLocalDesktopStorage(state.active);
		const root = await this.#availableFolder(state.active, state.activeId);
		if (root === null) throw new TemporaryProjectStorageUnavailableError('active');
		if (state.activeId !== undefined) return root;
		const catalog = fixedProjectLibraryPaths(this.#libraryPath(root)).databasePath;
		if (!(await optionalMetadata(catalog))?.isFile()) {
			// A legacy move may already have transferred its catalog to the destination.
			if (!state.moveStarted) throw new TemporaryProjectStorageUnavailableError('active');
			return root;
		}
		const activeId = await this.#rememberFolder(root);
		await this.#persist({ ...state, activeId, selectedId: state.active === state.selected ? activeId : state.selectedId });
		return root;
	}
	async #availableFolder(path: string, identity: string | undefined): Promise<string | null> {
		const root = await availableTemporaryFolder(path);
		if (root === null || identity === undefined) return root;
		return (await optionalMetadata(join(projectLibraryLocationDirectory(root, this.appName), identity)))?.isDirectory() ? root : null;
	}
	#libraryPath(root: string): string { return join(root, this.appName, 'project-library', 'v1'); }
	async #rememberFolder(root: string): Promise<string | undefined> {
		if (root === resolve(this.defaultRoot)) return undefined;
		const markerRoot = projectLibraryLocationDirectory(root, this.appName);
		await mkdir(markerRoot, { recursive: true, mode: 0o700 });
		const entries = await readdir(markerRoot, { withFileTypes: true });
		const existing = entries.find(entry => entry.isDirectory() && FOLDER_ID.test(entry.name));
		if (existing) return existing.name;
		const id = randomBytes(16).toString('hex');
		await mkdir(join(markerRoot, id), { mode: 0o700 });
		return id;
	}
	async #createCopyStage(location: string): Promise<string> {
		await assertCopyStageParent(location);
		const copyStage = `relocation-${randomBytes(16).toString('hex')}`;
		const path = join(location, copyStage);
		await mkdir(path, { mode: 0o700 });
		try { await this.#persist({ ...this.#state, copyStage }); }
		catch (error) {
			await rmdir(path).catch(() => undefined);
			throw error;
		}
		return path;
	}
	async #persist(state: FolderState): Promise<void> {
		await mkdir(dirname(this.configurationPath), { recursive: true, mode: 0o700 });
		const temporary = `${this.configurationPath}.tmp`;
		await writeFile(temporary, JSON.stringify(state), { mode: 0o600, flush: true });
		await rename(temporary, this.configurationPath);
		this.#state = state;
	}
}
async function optionalMetadata(path: string) {
	try { return await lstat(path); }
	catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === 'ENOENT' || code === 'ENOTDIR') return null;
		throw error;
	}
}
function folderId(value: object, key: 'activeId' | 'selectedId'): string | undefined {
	const id: unknown = Reflect.get(value, key);
	if (id === undefined) return undefined;
	if (typeof id !== 'string' || !FOLDER_ID.test(id)) throw new TypeError('Invalid temporary data folder identity.');
	return id;
}
function copyStageName(value: object): string | undefined {
	const stage: unknown = Reflect.get(value, 'copyStage');
	if (stage === undefined) return undefined;
	if (typeof stage !== 'string' || !COPY_STAGE.test(stage)) throw new TypeError('Invalid temporary library copy stage.');
	return stage;
}
async function assertCopyStageParent(path: string): Promise<void> {
	if (!(await lstat(path)).isDirectory()) throw new Error('The temporary library copy stage must be inside its library location.');
}
async function availableTemporaryFolder(path: string): Promise<string | null> {
	try {
		const selected = assertLocalDesktopStorage(path);
		return (await stat(selected)).isDirectory() ? selected : null;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === 'ENOENT' || code === 'ENOTDIR') return null;
		throw error;
	}
}
async function temporaryFolderIsWritable(path: string): Promise<boolean> {
	try { await access(path, constants.W_OK); return true; }
	catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || code === 'ENOENT' || code === 'ENOTDIR') return false;
		throw error;
	}
}
function folder(value: unknown): string {
	if (typeof value !== 'string' || value.length > 4096 || value.includes('\0') || !isAbsolute(value)) throw new TypeError('Temporary data folder must be an absolute directory.');
	return resolve(value);
}
