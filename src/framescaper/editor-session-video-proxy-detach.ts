/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoProxyAttachmentV18 } from '../common/editor/video-proxy-attachment-v18.ts';

interface Permit { leases: number; committed: boolean }
type ProjectPermits = Map<string, Permit>;
const permitsByPort = new WeakMap<object, Map<string, ProjectPermits>>();
const MAXIMUM_SESSION_ATTACHMENTS = 100_000;

interface DetachSession {
	subscribe(listener: (snapshot: Readonly<{
		tabs: readonly Readonly<{ projectId: string }>[];
	}>) => void): () => unknown;
}

export interface FramescaperProxyDetachPermit {
	complete(): void;
	rollback(): void;
}

/** Explicit Detach retains this exact pointer until the tab and its history close. */
export function bindFramescaperProxyDetachSession(port: object, session: DetachSession) {
	const projects = new Map<string, ProjectPermits>();
	permitsByPort.set(port, projects);
	let count = 0;
	let unsubscribe: (() => unknown) | undefined;

	function stopWatchingIfIdle(): void {
		if (count !== 0) return;
		unsubscribe?.();
		unsubscribe = undefined;
	}

	return (projectId: string, sourceId: string, attachment: Readonly<VideoProxyAttachmentV18>): FramescaperProxyDetachPermit => {
		const key = permitKey(sourceId, JSON.stringify(attachment));
		const permits = projects.get(projectId) ?? new Map<string, Permit>();
		let permit = permits.get(key);
		if (!permit) {
			if (count >= MAXIMUM_SESSION_ATTACHMENTS) throw new RangeError('The proxy detach session exceeds its supported attachment count.');
			permit = { leases: 0, committed: false };
			permits.set(key, permit);
			projects.set(projectId, permits);
			count += 1;
		}
		unsubscribe ??= session.subscribe(({ tabs }) => {
			for (const [id, grants] of projects) {
				if (tabs.some(({ projectId }) => projectId === id)) continue;
				projects.delete(id);
				count -= grants.size;
			}
			stopWatchingIfIdle();
		});
		const retained = permit;
		retained.leases += 1;
		let settled = false;
		return Object.freeze({
			complete() { finish(true); },
			rollback() { finish(false); },
		});

		function finish(committed: boolean): void {
			if (settled) return;
			settled = true;
			retained.leases -= 1;
			retained.committed ||= committed;
			if (retained.committed || retained.leases !== 0 || projects.get(projectId) !== permits) return;
			permits.delete(key);
			count -= 1;
			if (permits.size === 0) projects.delete(projectId);
			stopWatchingIfIdle();
		}
	};
}

export function framescaperProxyDetachAuthorized(
	port: object | undefined, projectId: string, sourceId: string, serializedAttachment: string,
): boolean {
	return port !== undefined
		&& permitsByPort.get(port)?.get(projectId)?.has(permitKey(sourceId, serializedAttachment)) === true;
}

function permitKey(sourceId: string, serializedAttachment: string): string {
	return JSON.stringify([sourceId, serializedAttachment]);
}
