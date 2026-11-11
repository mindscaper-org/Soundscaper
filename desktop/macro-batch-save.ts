/* SPDX-License-Identifier: AGPL-3.0-only */
import { randomBytes } from 'node:crypto';
import { lstat, realpath, link, unlink } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

interface Targets {
	registerPath(path: string, options: { owner: object; purpose: string; publish: (temporary: string) => Promise<void> }): { id: string; name: string };
	release(id: string, options: { owner: object }): unknown;
}
interface Grant {
	readonly id: string; readonly directory: string; files: readonly string[];
	readonly device: number; readonly inode: number; readonly targets: Set<string>;
	timer: ReturnType<typeof setTimeout>;
}
const IDLE_MS = 15 * 60 * 1000;

/** Native-selected folder authority; only one ordinary save target is needed per active file. */
export function createMacroBatchSaveService(options: { targets: Targets; chooseDirectory(): Promise<string | null> }) {
	const owners = new WeakMap<object, Map<string, Grant>>();
	const find = (owner: object, id: string): Grant => {
		const grant = owners.get(owner)?.get(id);
		if (!grant) throw new Error('The macro output folder grant is unavailable.');
		return grant;
	};
	const release = (owner: object, id: string): boolean => {
		const grant = owners.get(owner)?.get(id); if (!grant) return false;
		owners.get(owner)!.delete(id); clearTimeout(grant.timer);
		for (const target of grant.targets) options.targets.release(target, { owner });
		return true;
	};
	const arm = (owner: object, grant: Grant): void => {
		clearTimeout(grant.timer); grant.timer = setTimeout(() => { release(owner, grant.id); }, IDLE_MS); grant.timer.unref();
	};
	return Object.freeze({
		async select(owner: object, values: unknown = []) {
			const names = outputNames(values, true);
			if ((owners.get(owner)?.size ?? 0) >= 4) throw new RangeError('Too many macro output folders are open.');
			const selected = await options.chooseDirectory(); if (!selected) return null;
			if ((owners.get(owner)?.size ?? 0) >= 4) throw new RangeError('Too many macro output folders are open.');
			const directory = await realpath(selected), identity = await lstat(directory);
			if (!identity.isDirectory() || identity.isSymbolicLink()) throw new Error('The output folder is unavailable.');
			const files = await uniqueNames(directory, names);
			const id = randomBytes(24).toString('hex');
			const grant: Grant = { id, directory, files, device: identity.dev, inode: identity.ino, targets: new Set(), timer: setTimeout(() => undefined, 0) };
			const grants = owners.get(owner) ?? new Map<string, Grant>(); owners.set(owner, grants); grants.set(id, grant); arm(owner, grant);
			return describe(grant);
		},
		async plan(owner: object, id: string, values: unknown) {
			const names = outputNames(values), grant = find(owner, id), previousFiles = grant.files;
			const files = await uniqueNames(grant.directory, names);
			if (find(owner, id) !== grant || grant.files !== previousFiles) throw new Error('The macro output plan changed.');
			for (const target of grant.targets) options.targets.release(target, { owner });
			grant.targets.clear(); grant.files = files; arm(owner, grant);
			return describe(grant);
		},
		prepare(owner: object, id: string, index: number) {
			const grant = find(owner, id), plannedFiles = grant.files, name = plannedFiles[index];
			if (!Number.isSafeInteger(index) || index < 0 || !name) throw new RangeError('The output file index is invalid.');
			if (grant.targets.size >= grant.files.length * 2) throw new RangeError('The batch output target allowance is exhausted.');
			arm(owner, grant);
			const target = options.targets.registerPath(join(grant.directory, name), { owner, purpose: /\.wav$/iu.test(name) ? 'audio-pcm-mix' : 'audio', publish: async temporary => {
				if (find(owner, id) !== grant || grant.files !== plannedFiles) throw new Error('The macro output folder grant changed.');
				const identity = await lstat(grant.directory);
				if (!identity.isDirectory() || identity.isSymbolicLink() || identity.dev !== grant.device || identity.ino !== grant.inode) throw new Error('The output folder changed.');
				await link(temporary, join(grant.directory, name));
				await unlink(temporary);
			} });
			grant.targets.add(target.id); return target;
		},
		release,
	});
}

export function createMacroBatchSaveRequestHandler(options: Parameters<typeof createMacroBatchSaveService>[0]) {
	const service = createMacroBatchSaveService(options);
	return (owner: object, value: unknown): unknown => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A batch output request is required.');
		const request = value as Record<string, unknown>;
		const keys = request.kind === 'macro-file-folder' ? ['kind', 'suggestedNames']
			: request.kind === 'macro-file-plan' ? ['kind', 'batchId', 'suggestedNames']
			: request.kind === 'macro-file-target' ? ['kind', 'batchId', 'index'] : ['kind', 'batchId'];
		if (Object.keys(request).some(key => !keys.includes(key))) throw new TypeError('Unknown batch output fields.');
		if (request.kind === 'macro-file-folder') return service.select(owner, request.suggestedNames);
		if (typeof request.batchId !== 'string' || !/^[a-f0-9]{48}$/u.test(request.batchId)) throw new TypeError('An output folder grant is required.');
		if (request.kind === 'macro-file-plan') return service.plan(owner, request.batchId, request.suggestedNames);
		if (request.kind === 'macro-file-target') return service.prepare(owner, request.batchId, request.index as number);
		if (request.kind === 'macro-file-release') return service.release(owner, request.batchId);
		throw new TypeError('Unknown batch output operation.');
	};
}

function leaf(value: unknown): string {
	if (typeof value !== 'string' || !value || value.length > 180 || [...value].some(character => character.charCodeAt(0) < 32) || /[/\\:*?"<>|]/u.test(value)
		|| value === '.' || value === '..' || !/\.(?:wav|flac|mp3)$/iu.test(value)) throw new TypeError('A plain audio output file name is required.');
	return value;
}
async function exists(path: string): Promise<boolean> {
	try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

function outputNames(value: unknown, allowEmpty = false): string[] {
	if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.length > 100) throw new RangeError('Choose between 1 and 100 output names.');
	return value.map(leaf);
}
function describe(grant: Grant) {
	return { id: grant.id, name: basename(grant.directory), displayPath: grant.directory, files: grant.files };
}
async function uniqueNames(directory: string, names: readonly string[]): Promise<string[]> {
	const used = new Set<string>(), files: string[] = [];
	for (const name of names) {
		const suffix = extname(name), stem = name.slice(0, name.length - suffix.length);
		let candidate = name, number = 1;
		while (used.has(candidate.toLowerCase()) || await exists(join(directory, candidate))) candidate = `${stem}-${++number}${suffix}`;
		used.add(candidate.toLowerCase()); files.push(candidate);
	}
	return files;
}
