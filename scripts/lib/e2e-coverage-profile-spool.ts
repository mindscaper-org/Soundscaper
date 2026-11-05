/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { canonicalJson } from './canonical-json.mjs';

interface CoverageProfile {
	result: { url: string }[];
	'source-map-cache': Record<string, unknown>;
}

interface SurfaceState {
	count: number;
	hasEntries: boolean;
	names: Set<string>;
}

export interface CoverageProfileGroup {
	write(surface: string, name: string, profile: CoverageProfile): void;
	attachMaps(surface: string, cache: Record<string, unknown>): void;
	count(surface: string): number;
	storeSourceMap(url: string, cache: unknown, conflictMessage: string): void;
	readSourceMap(url: string): unknown;
}

export interface CoverageProfileSpool {
	directory: string;
	observedUrls: ReadonlySet<string>;
	group(prefix: string): CoverageProfileGroup;
	count(surface: string): number;
	hasEntries(surface: string): boolean;
}

/** Publish only after every run and all final capture validations have succeeded. */
export function withE2ECoverageProfileSpool<T>(
	destination: string,
	assemble: (spool: CoverageProfileSpool) => T,
): T {
	const directory = `${destination}.staging-${process.pid}-${randomUUID()}`;
	try {
		mkdirSync(directory, { recursive: true });
		const result = assemble(createSpool(directory));
		rmSync(join(directory, '.profile-cache'), { recursive: true, force: true });
		rmSync(destination, { recursive: true, force: true });
		mkdirSync(dirname(destination), { recursive: true });
		renameSync(directory, destination);
		return result;
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
}

function createSpool(directory: string): CoverageProfileSpool {
	const surfaces = new Map<string, SurfaceState>();
	const observedUrls = new Set<string>();
	let groupId = 0;
	return Object.freeze({
		directory,
		observedUrls,
		count: (surface: string) => surfaces.get(surface)?.count ?? 0,
		hasEntries: (surface: string) => surfaces.get(surface)?.hasEntries ?? false,
		group(prefix: string) {
			assertSegment(`${prefix}profile.json`);
			const cacheDirectory = join(directory, '.profile-cache', String(++groupId));
			const firstProfiles = new Map<string, string>();
			const counts = new Map<string, number>();
			// Only paths and validation fingerprints survive a profile read/write.
			const maps = new Map<string, { path: string; digest: string }>();
			return Object.freeze({
				write(surface: string, name: string, profile: CoverageProfile) {
					assertSegment(surface);
					assertSegment(name);
					const fileName = `${prefix}${name}`;
					const state = surfaces.get(surface) ?? { count: 0, hasEntries: false, names: new Set<string>() };
					if (state.names.has(fileName)) throw new Error(`Two raw E2E profiles resolve to ${fileName}.`);
					const path = join(directory, 'profiles', surface, fileName);
					writeJson(path, profile);
					state.names.add(fileName);
					state.count++;
					state.hasEntries ||= profile.result.length > 0;
					surfaces.set(surface, state);
					for (const { url } of profile.result) observedUrls.add(url);
					if (!firstProfiles.has(surface)) firstProfiles.set(surface, path);
					counts.set(surface, (counts.get(surface) ?? 0) + 1);
				},
				attachMaps(surface: string, cache: Record<string, unknown>) {
					const path = firstProfiles.get(surface);
					if (path === undefined) return;
					const profile = JSON.parse(readFileSync(path, 'utf8')) as CoverageProfile;
					Object.assign(profile['source-map-cache'], cache);
					writeJson(path, profile);
				},
				count: (surface: string) => counts.get(surface) ?? 0,
				storeSourceMap(url: string, cache: unknown, conflictMessage: string) {
					const canonical = canonicalJson(cache) as string;
					const digest = createHash('sha256').update(canonical).digest('hex');
					const previous = maps.get(url);
					if (previous !== undefined) {
						if (previous.digest !== digest
							|| canonicalJson(JSON.parse(readFileSync(previous.path, 'utf8'))) !== canonical) {
							throw new Error(conflictMessage);
						}
						return;
					}
					const path = join(cacheDirectory, `${maps.size}.json`);
					writeJson(path, cache);
					maps.set(url, { path, digest });
				},
				readSourceMap(url: string): unknown {
					const record = maps.get(url);
					return record === undefined ? undefined : JSON.parse(readFileSync(record.path, 'utf8')) as unknown;
				},
			});
		},
	});
}

function assertSegment(value: string): void {
	if (!/^[A-Za-z\d._-]+$/u.test(value) || value === '.' || value === '..') {
		throw new Error(`Unsafe E2E profile path segment ${value}.`);
	}
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, '\t')}\n`);
}
