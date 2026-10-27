/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperImageSourceV1 } from '../common/editor/timeline-image-model.ts';

interface Grant { readonly authority: string; leases: number; committed: boolean }
interface StoreGrants { readonly projects: Map<string, Map<string, Grant>>; count: number }
const stores = new WeakMap<object, StoreGrants>();
const MAXIMUM_SESSION_ATTACHMENTS = 100_000;

/** Only the authenticated body-staging owner calls this after verifying every exact frame pack. */
export function authorizeClipboardImageAttachments(port: object, projectId: string, sources: readonly FramescaperImageSourceV1[]) {
	let store = stores.get(port);
	if (!store) { store = { projects: new Map(), count: 0 }; stores.set(port, store); }
	let project = store.projects.get(projectId);
	if (!project) { project = new Map(); store.projects.set(projectId, project); }
	const rows = new Map(sources.map(source => [source.id, immutableImageBodyAuthority(source)]));
	for (const [id, authority] of rows) {
		const existing = project.get(id);
		if (existing && existing.authority !== authority) throw new Error('Clipboard image attachment authority changed.');
	}
	if (store.count + [...rows.keys()].filter(id => !project.has(id)).length > MAXIMUM_SESSION_ATTACHMENTS) {
		throw new RangeError('The clipboard image attachment session exceeds its supported source count.');
	}
	const retained: Array<readonly [string, Grant]> = [];
	for (const [id, authority] of rows) {
		let grant = project.get(id);
		if (!grant) { grant = { authority, leases: 0, committed: false }; project.set(id, grant); store.count += 1; }
		grant.leases += 1; retained.push([id, grant]);
	}
	let finished = false;
	return Object.freeze({
		complete() { finish(true); },
		rollback() { finish(false); },
	});
	function finish(committed: boolean): void {
		if (finished) return;
		finished = true;
		for (const [id, grant] of retained) {
			grant.committed ||= committed; grant.leases -= 1;
			if (!grant.committed && grant.leases === 0) { project!.delete(id); store!.count -= 1; }
		}
	}
}

export function clipboardImageAttachmentAuthorized(port: object | undefined, projectId: string, sourceId: string, authority: string): boolean {
	return port !== undefined && stores.get(port)?.projects.get(projectId)?.get(sourceId)?.authority === authority;
}

export function immutableImageBodyAuthority(source: Readonly<Record<string, unknown>> | FramescaperImageSourceV1): string {
	const { name: _name, ...authority } = source;
	return JSON.stringify(authority);
}
