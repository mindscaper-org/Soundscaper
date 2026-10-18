/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';

import { collectV8ProfileObservations, type RawV8Profile } from './e2e-v8-profile-observations.ts';

interface Script { coverageUrl: string; coverageKey: string }
interface PinnedFile { path: string; byteLength: number; sha256: string }
interface Group { index: number; files: PinnedFile[] }
interface RebasedFile { name: string; pin: PinnedFile | null }

/** Payload memory is one input/rebase or one equivalence group, never all groups. */
export function withV8MaterializationSpool<T>(reportDirectory: string, scripts: readonly Script[],
	use: (spool: ReturnType<typeof createSpool>) => T): T {
	mkdirSync(reportDirectory, { recursive: true });
	const directory = mkdtempSync(join(reportDirectory, '.v8-union-staging-'));
	try { return use(createSpool(directory, scripts)); }
	finally { rmSync(directory, { recursive: true, force: true }); }
}

function createSpool(directory: string, scripts: readonly Script[]) {
	const groups = new Map<string, Group>();
	const keysByUrl = new Map<string, Set<string>>();
	for (const script of scripts) {
		if (!groups.has(script.coverageKey)) groups.set(script.coverageKey, { index: groups.size, files: [] });
		const keys = keysByUrl.get(script.coverageUrl) ?? new Set<string>();
		keys.add(script.coverageKey); keysByUrl.set(script.coverageUrl, keys);
	}
	const rebased = join(directory, 'rebased');
	mkdirSync(rebased);
	let surfaceIndex = 0;
	let count = 0;
	const rebasedFiles: PinnedFile[] = [];
	let rebaseFailed = false;
	let rebaseError: unknown;
	return {
		get count() { return count; },
		beginSurface(surface: string, rebase: (profile: RawV8Profile) => unknown) {
			const surfaceDirectory = join(directory, `surface-${surfaceIndex++}`);
			mkdirSync(surfaceDirectory);
			const files: RebasedFile[] = [];
			const observations = new Map<string, PinnedFile[]>();
			let failed = false;
			let failure: unknown;
			return {
				write(name: string, profile: RawV8Profile) {
					const index = files.length;
					const filename = `coverage-${surface}-${String(count + index).padStart(6, '0')}-${name}`;
					const path = join(surfaceDirectory, filename);
					let pin: PinnedFile | null = null;
					try { pin = writePinned(path, JSON.stringify(rebase(profile))); }
					catch (error) { if (!failed) { failed = true; failure = error; } }
					files.push({ name: filename, pin });
					const grouped = groupProfile(profile, keysByUrl);
					for (const [key, value] of grouped) {
						const group = groups.get(key)!;
						const file = join(surfaceDirectory, `group-${group.index}-profile-${index}.json`);
						const paths = observations.get(key) ?? [];
						paths.push(writePinned(file, JSON.stringify(value))); observations.set(key, paths);
					}
				},
				accept() {
					if (failed && !rebaseFailed) { rebaseFailed = true; rebaseError = failure; }
					for (const file of files) {
						if (file.pin) {
							const path = join(rebased, file.name);
							renameSync(file.pin.path, path); rebasedFiles.push({ ...file.pin, path });
						}
					}
					for (const [key, paths] of observations) {
						for (const path of paths) groups.get(key)!.files.push(path);
					}
					count += files.length;
				},
			};
		},
		observationsForGroup(key: string) {
			const group = groups.get(key);
			if (!group) throw new Error('Topology requested an un-inventoried equivalence group.');
			// The existing validator still sees every original observation for this key.
			const observations = collectV8ProfileObservations(group.files.map(file => (
				JSON.parse(readPinned(file).toString('utf8')) as RawV8Profile
			)));
			return observations;
		},
		publish(destination: string) {
			if (rebaseFailed) throw rebaseError;
			const expected = new Set(rebasedFiles.map(file => basename(file.path)));
			const members = readdirSync(rebased, { withFileTypes: true });
			if (members.length !== expected.size || members.some(member => !member.isFile() || !expected.has(member.name))) {
				throw new Error('Staged V8 profile membership changed.');
			}
			for (const file of rebasedFiles) readPinned(file);
			rmSync(destination, { recursive: true, force: true });
			renameSync(rebased, destination);
		},
	};
}

function writePinned(path: string, value: string): PinnedFile {
	const bytes = Buffer.from(value);
	writeFileSync(path, bytes, { flag: 'wx' });
	return { path, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function readPinned(file: PinnedFile) {
	const bytes = readFileSync(file.path);
	if (bytes.byteLength !== file.byteLength || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
		throw new Error(`Staged V8 profile bytes changed: ${file.path}`);
	}
	return bytes;
}

function groupProfile(profile: RawV8Profile, keysByUrl: ReadonlyMap<string, ReadonlySet<string>>) {
	const grouped = new Map<string, RawV8Profile>();
	const group = (key: string) => {
		let value = grouped.get(key);
		if (!value) { value = { result: [], 'source-map-cache': {} }; grouped.set(key, value); }
		return value;
	};
	for (const entry of Array.isArray(profile?.result) ? profile.result : []) {
		if (typeof entry?.url !== 'string') continue;
		for (const key of keysByUrl.get(entry.url) ?? []) group(key).result!.push(entry);
	}
	for (const [url, cache] of Object.entries(profile?.['source-map-cache'] ?? {})) {
		for (const key of keysByUrl.get(url) ?? []) group(key)['source-map-cache']![url] = cache;
	}
	return grouped;
}
