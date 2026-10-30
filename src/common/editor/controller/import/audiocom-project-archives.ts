/* SPDX-License-Identifier: AGPL-3.0-only */
import type { OnlineMediaFailure } from '../../online-media-failure.ts';
import { createProjectArchives } from './internal/audiocom-project-archives.ts';

export interface AudiocomProjectArchive {
	readonly id: string;
	readonly name: string;
	readonly format: 'aup3' | 'aup4';
	readonly size: number;
	readonly snapshotId: string | null;
}
export interface AudiocomArchivePage {
	readonly results: readonly AudiocomProjectArchive[];
	readonly page: number;
	readonly hasNext: boolean;
}
export interface AudiocomArchiveCapabilities {
	readonly formats: readonly ('aup3' | 'aup4')[];
	readonly maximumBytes: number;
	readonly provider?: Readonly<{ kind: 'audiocom' | 'audiocity'; webOrigin: string }>;
}
export interface AudiocomProjectArchiveClient {
	capabilities(signal?: AbortSignal): Promise<AudiocomArchiveCapabilities>;
	list(page: number, signal?: AbortSignal): Promise<AudiocomArchivePage>;
	upload(file: File, name: string, signal?: AbortSignal, revision?: AudiocomProjectArchive): Promise<AudiocomProjectArchive>;
}
export interface AudiocomArchiveSnapshot extends AudiocomArchivePage, AudiocomArchiveCapabilities {
	readonly supported: boolean;
	readonly status: 'idle' | 'loading' | 'ready' | 'uploading' | 'error';
	readonly errorMessage?: string;
	readonly requestFailure?: OnlineMediaFailure;
	readonly completedFileName?: string;
}
export interface AudiocomProjectArchives {
	getSnapshot(): AudiocomArchiveSnapshot;
	subscribe(listener: () => void): () => void;
	initialize(): Promise<void>;
	setConnected(connected: boolean): Promise<void>;
	refresh(page: number): Promise<void>;
	saveProject(projectId: string, serialize: (format: 'aup3' | 'aup4', signal: AbortSignal) => Promise<File>): Promise<void>;
	cancel(): void;
	dispose(): void;
}
export interface AudiocomProjectArchiveOptions {
	readonly apiOrigin?: string;
	readonly client?: AudiocomProjectArchiveClient;
	readonly onAuthenticationExpired?: () => void;
	readonly revisionStorage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

/** Audacity-compatible project synchronization for the selected server. */
export function createAudiocomProjectArchives(options: AudiocomProjectArchiveOptions = {}): AudiocomProjectArchives {
	return createProjectArchives(options);
}

const ownerArchives = new WeakMap<object, { origin: string; archives: AudiocomProjectArchives; unsubscribe?: () => void }>();

/** Retain cloud revision identity through panel closing and docking. */
export function audiocomProjectArchives(owner: object, options: AudiocomProjectArchiveOptions = {}): AudiocomProjectArchives {
	const origin = options.apiOrigin ?? 'https://api.audio.com';
	const previous = ownerArchives.get(owner);
	if (previous?.origin === origin) return previous.archives;
	previous?.archives.dispose(); previous?.unsubscribe?.();
	const archives = createProjectArchives(options);
	const entry: { origin: string; archives: AudiocomProjectArchives; unsubscribe?: () => void } = { origin, archives };
	ownerArchives.set(owner, entry);
	const lifecycle = owner as { getSnapshot?: () => { disposed?: boolean; preferences?: { advanced?: { audioComServerUrl?: string } } }; subscribe?: (listener: () => void) => () => void };
	const check = (): void => {
		const snapshot = lifecycle.getSnapshot?.();
		const selectedOrigin = snapshot?.preferences?.advanced?.audioComServerUrl;
		if (!snapshot?.disposed && (selectedOrigin === undefined || selectedOrigin === origin)) return;
		archives.dispose(); entry.unsubscribe?.();
		if (ownerArchives.get(owner) === entry) ownerArchives.delete(owner);
	};
	entry.unsubscribe = lifecycle.subscribe?.(check); check();
	return archives;
}
