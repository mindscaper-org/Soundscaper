/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { OriginalFileOverwriteStore } from './original-file-overwrite.ts';

type Entry = Readonly<{ path: string; identity: Record<string, string>; baseline: string }>;

/** Paths remain in main; renderer sessions receive only newly minted permissions. */
export class ProjectFileAssociations {
	#entries: Record<string, Entry> = Object.create(null) as Record<string, Entry>;
	#tail: Promise<unknown> = Promise.resolve();
	constructor(readonly filePath: string, readonly originals: OriginalFileOverwriteStore) {}
	async load(): Promise<void> {
		try {
			const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
			for (const [id, entry] of Object.entries(parsed)) {
				if (validId(id) && validEntry(entry)) this.#entries[id] = entry;
			}
		} catch (error) { if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
	}
	async remember(projectId: string, originalId: string, baseline: string, owner: object): Promise<void> {
		if (!validId(projectId) || !/^[a-f0-9]{64}$/u.test(baseline)) throw new TypeError('Invalid project file association');
		const reference = this.originals.projectReference(originalId, { owner });
		const entry = { ...reference, baseline };
		const operation = this.#tail.catch(() => undefined).then(async () => {
			const next = { ...this.#entries, [projectId]: entry };
			await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
			const temporary = `${this.filePath}.${randomUUID()}.tmp`;
			await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
			await rename(temporary, this.filePath);
			this.#entries = next;
		});
		this.#tail = operation;
		await operation;
	}
	async restore(projectId: string, owner: object): Promise<Readonly<{ baseline: string; originalFile: Readonly<{ id: string; name: string }> | null }> | null> {
		if (!validId(projectId)) throw new TypeError('Invalid project identity');
		await this.#tail;
		const entry = this.#entries[projectId];
		if (!entry) return null;
		try { return { baseline: entry.baseline, originalFile: await this.originals.restoreProjectReference(entry, { owner }) }; }
		catch { return { baseline: entry.baseline, originalFile: null }; }
	}
}
function validId(value: string): boolean { return Boolean(value && value.length <= 256 && !['__proto__', 'constructor', 'prototype'].includes(value)); }
function validEntry(value: unknown): value is Entry {
	if (!value || typeof value !== 'object') return false;
	const entry = value as Partial<Entry>;
	return typeof entry.path === 'string' && isAbsolute(entry.path) && !entry.path.includes('\0')
		&& typeof entry.baseline === 'string' && /^[a-f0-9]{64}$/u.test(entry.baseline)
		&& !!entry.identity && ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => typeof entry.identity?.[key] === 'string' && /^\d+$/u.test(entry.identity[key]!));
}
