/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { access, lstat, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { exactOriginalFileIdentity as identity, type ExactOriginalFileIdentity as Identity } from './original-file-identity.ts';

type Owner = object;
type OriginalFile = Readonly<{ id: string; name: string }>;
type Entry = { id: string; path: string; name: string; owner: Owner; identity: Identity; directory: Identity };
type CopySource = Readonly<{ owner: Owner; path: string; canonical: string; identity: Identity }>;
const isProject = (path: string) => /\.(?:sscape|fscape|liscape|scape)$/iu.test(path);
type ReadStore = {
	resolveOriginalFileGrant(id: string, options: { owner: Owner }): Promise<{
		path: string; identity: Identity;
	} | null>;
};
type TargetStore = {
	registerPath(path: string, options: {
		owner: Owner; purpose: string;
		beforeCommit(): Promise<void>;
		afterCommit?(published: Identity): Promise<void>;
	}): OriginalFile;
};
interface Options {
	reads: ReadStore;
	targets: TargetStore;
	acceptsFile(purpose: string, path: string): boolean;
	cleanDisplayName(value: string): string;
	maximumCount: number;
}

/** Main-owned overwrite authority survives the temporary import read capability. */
export class OriginalFileOverwriteStore {
	#reads: ReadStore;
	#targets: TargetStore;
	#acceptsFile: Options['acceptsFile'];
	#cleanDisplayName: Options['cleanDisplayName'];
	#maximumCount: number;
	#entries = new Map<string, Entry>();
	#copySources = new Map<string, CopySource>();
	#revokedOwners = new WeakSet<Owner>();
	#disposed = false;

	constructor({ reads, targets, acceptsFile, cleanDisplayName, maximumCount }: Options) {
		this.#reads = reads;
		this.#targets = targets;
		this.#acceptsFile = acceptsFile;
		this.#cleanDisplayName = cleanDisplayName;
		this.#maximumCount = maximumCount;
	}

	async registerRead(readId: string, { owner }: { owner: Owner }): Promise<OriginalFile | null> {
		this.#assertOwner(owner);
		if ([...this.#entries.values()].filter((entry) => entry.owner === owner).length >= this.#maximumCount) return null;
		try {
			const granted = await this.#reads.resolveOriginalFileGrant(readId, { owner });
			if (!granted || (!isProject(granted.path) && !this.#acceptsFile('audio', granted.path) && !this.#acceptsFile('video', granted.path))) return null;
			const details = await lstat(granted.path, { bigint: true });
			assertIdentity(details, granted.identity);
			await assertWritable(granted.path, details);
			const directory = identity(await lstat(dirname(granted.path), { bigint: true }));
			this.#assertOwner(owner);
			let id: string;
			do id = randomBytes(24).toString('hex'); while (this.#entries.has(id));
			if ([...this.#entries.values()].filter((entry) => entry.owner === owner).length >= this.#maximumCount) return null;
			const entry = { id, path: granted.path, name: this.#cleanDisplayName(basename(granted.path)), owner, identity: granted.identity, directory };
			this.#entries.set(id, entry);
			return Object.freeze({ id, name: entry.name });
		} catch {
			// Importing remains available when safe replacement is unavailable.
			return null;
		}
	}

	/** A copy source identifies the input without granting permission to replace it. */
	async protectCopySource(readId: string, { owner }: { owner: Owner }): Promise<string> {
		this.#assertOwner(owner);
		const granted = await this.#reads.resolveOriginalFileGrant(readId, { owner });
		if (!granted || !isProject(granted.path)) throw new Error('The original project selection is unavailable.');
		const path = resolve(granted.path);
		const canonical = await canonicalCopyPath(path);
		this.#assertOwner(owner);
		if ([...this.#copySources.values()].filter(source => source.owner === owner).length >= this.#maximumCount) {
			throw new RangeError('Project copy source limit reached');
		}
		let id: string;
		do id = randomBytes(24).toString('hex'); while (this.#entries.has(id) || this.#copySources.has(id));
		this.#copySources.set(id, Object.freeze({ owner, path, canonical, identity: granted.identity }));
		return id;
	}

	async #assertCopyDestination(id: string, output: string, owner: Owner): Promise<void> {
		this.#assertOwner(owner);
		const source = this.#copySources.get(id);
		if (!source || source.owner !== owner) throw new Error('The project copy source is unavailable.');
		const path = resolve(output);
		const canonical = await canonicalCopyPath(path);
		const outputFile = await optionalCopyFile(path);
		const currentSource = outputFile ? await optionalCopyFile(source.path, true) : null;
		this.#assertOwner(owner);
		if (this.#copySources.get(id) !== source) throw new Error('The project copy source is unavailable.');
		if (sameCopyPath(path, source.path) || sameCopyPath(canonical, source.canonical)
			|| [source.identity, currentSource].some(entry => entry && entry.ino !== 0n
				&& outputFile?.dev === entry.dev && outputFile.ino === entry.ino)) {
			throw new Error('Choose a different file for the project copy. The original project is protected.');
		}
	}

	async prepare(id: string, options: { owner: Owner }): Promise<OriginalFile>;
	async prepare(id: string, options: { owner: Owner; allowProjectSavePicker: true }): Promise<OriginalFile | null>;
	async prepare(id: string, { owner, allowProjectSavePicker = false }: {
		owner: Owner; allowProjectSavePicker?: boolean;
	}): Promise<OriginalFile | null> {
		this.#assertOwner(owner);
		if (allowProjectSavePicker && !this.#entries.has(id)) return null;
		const entry = this.#entry(id, owner);
		if (allowProjectSavePicker && !isProject(entry.path)) throw new TypeError('A Scape project original is required');
		const expected = entry.identity;
		try { await this.#assertCurrent(entry, expected); }
		catch (error) {
			if (!allowProjectSavePicker) throw error;
			this.#assertOwner(owner);
			return null;
		}
		return this.#targets.registerPath(entry.path, {
			owner, purpose: isProject(entry.path) ? 'project' : this.#acceptsFile('video', entry.path) ? 'video' : 'audio',
			beforeCommit: () => this.#assertCurrent(entry, expected),
			afterCommit: async (published) => {
				try {
					const details = await lstat(entry.path, { bigint: true });
					if (!details.isFile() || details.dev !== published.dev || details.ino !== published.ino || details.size !== published.size || details.mtimeNs !== published.mtimeNs) throw new Error('Published original changed');
					entry.identity = identity(details);
				} catch {
					// Publication succeeded; retire repeat permission if it cannot be refreshed.
					this.#entries.delete(entry.id);
				}
			},
		});
	}

	/** A save-picker destination becomes reusable authority only after publication. */
	async registerProjectSave(path: string, { owner, copySourceId }: { owner: Owner; copySourceId?: string }): Promise<OriginalFile & { originalFile: OriginalFile }> {
		const beforeCommit = await this.#projectDestinationCheck(path, owner, copySourceId);
		if ([...this.#entries.values()].filter(entry => entry.owner === owner).length >= this.#maximumCount) throw new RangeError('Project file permission limit reached');
		const id = randomBytes(24).toString('hex');
		const name = this.#cleanDisplayName(basename(path));
		const target = this.#targets.registerPath(path, {
			owner, purpose: 'project', beforeCommit,
			afterCommit: async (published) => {
				this.#assertOwner(owner);
				const details = await lstat(path, { bigint: true });
				if (!details.isFile() || (['dev', 'ino', 'size', 'mtimeNs'] as const).some(key => details[key] !== published[key])) throw new Error('Published original changed');
				const directory = identity(await lstat(dirname(path), { bigint: true }));
				this.#entries.set(id, { id, name, path, owner, identity: identity(details), directory });
			},
		});
		return Object.freeze({ ...target, originalFile: Object.freeze({ id, name }) });
	}

	async registerProjectCopy(path: string, { owner }: { owner: Owner }): Promise<OriginalFile> {
		const beforeCommit = await this.#projectDestinationCheck(path, owner);
		return this.#targets.registerPath(path, { owner, purpose: 'project-copy', beforeCommit });
	}

	async #projectDestinationCheck(path: string, owner: Owner, copySourceId?: string): Promise<() => Promise<void>> {
		this.#assertOwner(owner);
		if (!isProject(path)) throw new TypeError('A Scape project destination is required');
		if (copySourceId) await this.#assertCopyDestination(copySourceId, path, owner);
		const expected = await pickedProjectDestination(path);
		this.#assertOwner(owner);
		return async () => {
			if (copySourceId) await this.#assertCopyDestination(copySourceId, path, owner);
			this.#assertOwner(owner);
			const current = await pickedProjectDestination(path);
			this.#assertOwner(owner);
			if (current.directory.dev !== expected.directory.dev || current.directory.ino !== expected.directory.ino
				|| !sameIdentity(current.file, expected.file)) {
				throw Object.assign(new Error('The selected project save destination changed.'), { code: 'PROJECT_SAVE_DESTINATION_CHANGED' });
			}
		};
	}

	projectReference(id: string, { owner }: { owner: Owner }): Readonly<{ path: string; identity: Record<string, string> }> {
		const entry = this.#entry(id, owner);
		if (!isProject(entry.path)) throw new TypeError('A Scape project original is required');
		return { path: entry.path, identity: Object.fromEntries(Object.entries(entry.identity).map(([key, value]) => [key, String(value)])) };
	}

	async restoreProjectReference(reference: Readonly<{ path: string; identity: Record<string, string> }>, { owner }: { owner: Owner }): Promise<OriginalFile> {
		this.#assertOwner(owner);
		if (!isProject(reference.path)) throw new TypeError('A Scape project original is required');
		if ([...this.#entries.values()].filter(entry => entry.owner === owner).length >= this.#maximumCount) throw new RangeError('Project file permission limit reached');
		const details = await lstat(reference.path, { bigint: true });
		const expected = Object.fromEntries(Object.entries(reference.identity).map(([key, value]) => [key, BigInt(value)])) as unknown as Identity;
		assertIdentity(details, expected);
		await assertWritable(reference.path, details);
		const directory = identity(await lstat(dirname(reference.path), { bigint: true }));
		this.#assertOwner(owner);
		const id = randomBytes(24).toString('hex'), name = this.#cleanDisplayName(basename(reference.path));
		this.#entries.set(id, { id, name, path: reference.path, owner, identity: expected, directory });
		return Object.freeze({ id, name });
	}

	release(id: string, { owner }: { owner: Owner }): boolean {
		this.#assertOwner(owner);
		const entry = this.#entries.get(id) ?? this.#copySources.get(id);
		if (!entry) return false;
		if (entry.owner !== owner) throw new Error('Original file belongs to another renderer owner');
		return this.#entries.delete(id) || this.#copySources.delete(id);
	}

	revokeOwner(owner: Owner): void {
		this.#revokedOwners.add(owner);
		for (const entry of this.#entries.values()) if (entry.owner === owner) this.#entries.delete(entry.id);
		for (const [id, source] of this.#copySources) if (source.owner === owner) this.#copySources.delete(id);
	}

	dispose(): void {
		this.#disposed = true;
		this.#entries.clear();
		this.#copySources.clear();
	}

	async #assertCurrent(entry: Entry, expected: Identity): Promise<void> {
		try {
			this.#entry(entry.id, entry.owner);
			const details = await lstat(entry.path, { bigint: true });
			assertIdentity(details, expected);
			const directory = await lstat(dirname(entry.path), { bigint: true });
			if (directory.dev !== entry.directory.dev || directory.ino !== entry.directory.ino) throw new Error('The original file directory changed');
			await assertWritable(entry.path, details);
			this.#entry(entry.id, entry.owner);
		} catch (cause) {
			throw new Error('The original file changed or is unavailable for overwrite', { cause });
		}
	}

	#entry(id: string, owner: Owner): Entry {
		this.#assertOwner(owner);
		const entry = this.#entries.get(id);
		if (!entry) throw new Error('Original file overwrite is unavailable');
		if (entry.owner !== owner) throw new Error('Original file belongs to another renderer owner');
		return entry;
	}

	#assertOwner(owner: Owner): void {
		if (!owner || typeof owner !== 'object') throw new TypeError('Original files require an opaque renderer owner');
		if (this.#disposed || this.#revokedOwners.has(owner)) throw new Error('Original file renderer owner was revoked');
	}
}

async function canonicalCopyPath(path: string): Promise<string> {
	try { return await realpath(path); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		return join(await realpath(dirname(path)), basename(path));
	}
}

async function optionalCopyFile(path: string, permitInaccessible = false): Promise<BigIntStats | null> {
	try { return await stat(path, { bigint: true }); }
	catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== 'ENOENT' && !(permitInaccessible && (code === 'EACCES' || code === 'EPERM' || code === 'ENOTDIR'))) throw error;
		return null;
	}
}

function sameCopyPath(left: string, right: string): boolean {
	return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function assertIdentity(details: BigIntStats, expected: Identity): void {
	if (!details.isFile() || !sameIdentity(details, expected)) {
		throw new Error('The original file changed since it was imported');
	}
}

function sameIdentity(first: Identity | null, second: Identity | null): boolean {
	return (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'] as const).every(key => first?.[key] === second?.[key]);
}

async function pickedProjectDestination(path: string) {
	const directory = await stat(dirname(path), { bigint: true });
	try { return { directory, file: identity(await lstat(path, { bigint: true })) }; }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		return { directory, file: null };
	}
}

async function assertWritable(path: string, details: BigIntStats): Promise<void> {
	if ((details.mode & 0o222n) === 0n) throw new Error('The original file is read-only');
	await Promise.all([access(path, constants.W_OK), access(dirname(path), constants.W_OK)]);
}
