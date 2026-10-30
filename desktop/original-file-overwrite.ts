/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { access, lstat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { exactOriginalFileIdentity as identity, type ExactOriginalFileIdentity as Identity } from './original-file-identity.ts';

type Owner = object;
type OriginalFile = Readonly<{ id: string; name: string }>;
type Entry = { id: string; path: string; name: string; owner: Owner; identity: Identity; directory: Identity };
type ReadStore = {
	resolveOriginalFileGrant(id: string, options: { owner: Owner }): Promise<{
		path: string; identity: Identity;
	} | null>;
};
type TargetStore = {
	registerPath(path: string, options: {
		owner: Owner; purpose: string;
		beforeCommit(): Promise<void>;
		afterCommit(published: Identity): Promise<void>;
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
			if (!granted || (!this.#acceptsFile('audio', granted.path) && !this.#acceptsFile('video', granted.path))) return null;
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

	async prepare(id: string, { owner }: { owner: Owner }): Promise<OriginalFile> {
		const entry = this.#entry(id, owner);
		const expected = entry.identity;
		await this.#assertCurrent(entry, expected);
		return this.#targets.registerPath(entry.path, {
			owner, purpose: this.#acceptsFile('video', entry.path) ? 'video' : 'audio',
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

	release(id: string, { owner }: { owner: Owner }): boolean {
		this.#assertOwner(owner);
		const entry = this.#entries.get(id);
		if (!entry) return false;
		if (entry.owner !== owner) throw new Error('Original file belongs to another renderer owner');
		return this.#entries.delete(id);
	}

	revokeOwner(owner: Owner): void {
		this.#revokedOwners.add(owner);
		for (const entry of this.#entries.values()) if (entry.owner === owner) this.#entries.delete(entry.id);
	}

	dispose(): void {
		this.#disposed = true;
		this.#entries.clear();
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

function assertIdentity(details: BigIntStats, expected: Identity): void {
	if (!details.isFile() || (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'] as const).some((key) => details[key] !== expected[key])) {
		throw new Error('The original file changed since it was imported');
	}
}

async function assertWritable(path: string, details: BigIntStats): Promise<void> {
	if ((details.mode & 0o222n) === 0n) throw new Error('The original file is read-only');
	await Promise.all([access(path, constants.W_OK), access(dirname(path), constants.W_OK)]);
}
