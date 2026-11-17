/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainArray, readClosedDomainRecord } from '../foundation/closed-domain-value.ts';

export const SUBPROJECT_LIMIT = 64;
export const SUBPROJECT_DEPTH_LIMIT = 8;
export interface SubprojectLink {
	readonly id: string;
	readonly projectId: string;
	readonly libraryId: string;
	readonly title: string;
	readonly sourceId: string;
	readonly followLatest: boolean;
	readonly revision: number;
	readonly contentDigest: string;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
}
const FIELDS = ['id', 'projectId', 'libraryId', 'title', 'sourceId', 'followLatest', 'revision',
	'contentDigest', 'sampleRate', 'channelCount', 'frameCount'] as const;

export function readSubprojectLinks(project: unknown): readonly SubprojectLink[] {
	const root = record(project), metadata = record(dataProperty(root, 'metadata'));
	const value = dataProperty(metadata, 'subprojects');
	if (value === undefined) return [];
	const links = readClosedDomainArray(value, 'subprojects', 0, SUBPROJECT_LIMIT);
	const ids = new Set<string>(), sourceIds = new Set<string>();
	return links.map(value => {
		const link = readClosedDomainRecord(value, 'subproject link', FIELDS, FIELDS);
		for (const key of ['id', 'projectId', 'libraryId', 'sourceId', 'title'] as const) {
			if (typeof link[key] !== 'string' || !link[key] || link[key].length > 256) throw new TypeError(`Invalid subproject ${key}.`);
		}
		if (ids.has(String(link.id)) || sourceIds.has(String(link.sourceId))) throw new RangeError('Subproject IDs and proxy sources must be unique.');
		ids.add(String(link.id)); sourceIds.add(String(link.sourceId));
		if (link.projectId === dataProperty(root, 'id')) throw new RangeError('A project cannot contain itself as a subproject.');
		if (typeof link.followLatest !== 'boolean' || typeof link.contentDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(link.contentDigest)) {
			throw new TypeError('Invalid subproject update mode or content digest.');
		}
		for (const key of ['revision', 'sampleRate', 'channelCount', 'frameCount'] as const) {
			if (!Number.isSafeInteger(link[key]) || Number(link[key]) < (key === 'revision' ? 0 : 1)) throw new RangeError(`Invalid subproject ${key}.`);
		}
		if (Number(link.channelCount) > 64) throw new RangeError('Subproject output supports at most 64 channels.');
		return Object.freeze({ ...link }) as unknown as SubprojectLink;
	});
}

export function validateSubprojectLinks(project: unknown): void {
	const root = record(project);
	const sources = Array.isArray(root?.sources) ? root.sources.map(record) : [];
	for (const link of readSubprojectLinks(project)) {
		if (root?.schemaFamily !== 'soundscaper') throw new RangeError('Subprojects require a Soundscaper project.');
		const source = sources.find(candidate => candidate?.id === link.sourceId);
		if (!source || source.kind !== 'audio' || source.sampleRate !== link.sampleRate
			|| source.channelCount !== link.channelCount || source.frameCount !== link.frameCount) {
			throw new RangeError('A subproject requires its exact rendered source geometry.');
		}
	}
}

/** A saved editing state also needs readers to preserve its linked-source authority. */
export function projectHasSubprojectLinks(project: unknown): boolean {
	if (readSubprojectLinks(project).length > 0) return true;
	const snapshots = dataProperty(record(dataProperty(record(project), 'metadata')), 'sessionSnapshots');
	return snapshots !== undefined && readClosedDomainArray(snapshots, 'session snapshots', 0, 64)
		.some(snapshot => readSubprojectLinks(dataProperty(record(snapshot), 'state')).length > 0);
}

/** The digest also binds resolved descendants, whose saved ancestors may be unchanged. */
export function subprojectContentDigest(project: unknown, descendants: readonly string[] = []): string {
	const root = record(project);
	if (!root) throw new TypeError('A subproject document is required.');
	const metadata = dataSnapshot(record(dataProperty(root, 'metadata')));
	delete metadata.sessionSnapshots;
	const audible: Record<string, unknown> = { ...dataSnapshot(root), metadata };
	for (const key of ['selection', 'loop', 'snap', 'view', 'updatedAt', 'createdAt', 'revision', 'timeDisplay']) delete audible[key];
	return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([canonical(audible), descendants]))));
}

function canonical(value: unknown, seen = new Set<object>(), budget = { remaining: 500_000 }): unknown {
	if (--budget.remaining < 0) throw new RangeError('The subproject content identity exceeds its inspection limit.');
	const object = record(value);
	if (!object && !Array.isArray(value)) return value;
	const identity = value as object;
	if (seen.has(identity)) throw new TypeError('Subproject document data must not be cyclic.');
	seen.add(identity);
	const output = Array.isArray(value)
		? readClosedDomainArray(value, 'subproject data', 0, 100_000).map(entry => canonical(entry, seen, budget))
		: Object.fromEntries(Object.keys(object!).sort().map(key => [key, canonical(dataProperty(object, key), seen, budget)]));
	seen.delete(identity);
	return output;
}
function dataSnapshot(value: Record<string, unknown> | null): Record<string, unknown> {
	return Object.fromEntries(Object.keys(value ?? {}).map(key => [key, dataProperty(value, key)]));
}
function dataProperty(value: Record<string, unknown> | null, key: string): unknown {
	const descriptor = value && Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return undefined;
	if (!Object.hasOwn(descriptor, 'value')) throw new TypeError(`Subproject ${key} must be a data property.`);
	return descriptor.value;
}
function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
