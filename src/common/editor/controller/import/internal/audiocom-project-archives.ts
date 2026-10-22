/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AudiocomArchiveSnapshot, AudiocomProjectArchive, AudiocomProjectArchiveOptions, AudiocomProjectArchives } from '../audiocom-project-archives.ts';
import { createAudiocomProjectArchiveClient } from './audiocom-project-archive-client.ts';
import { AudiocomApiError } from './audiocom-api-client.ts';
import { projectBindings } from './audiocom-project-bindings.ts';

const empty = (): AudiocomArchiveSnapshot => ({ supported: false, formats: [], maximumBytes: 100000000,
	results: [], page: 1, hasNext: false, status: 'idle' });

export function createProjectArchives(options: AudiocomProjectArchiveOptions): AudiocomProjectArchives {
	const client = options.client ?? createAudiocomProjectArchiveClient({ apiOrigin: options.apiOrigin });
	const listeners = new Set<() => void>();
	let snapshot = empty(); let connected = false; let disposed = false;
	let generation = 0; let abort: AbortController | null = null;
	let initialized = false;
	const savedProjects = new Map<string, AudiocomProjectArchive>();
	const bindings = projectBindings(options);
	const emit = (patch: Partial<AudiocomArchiveSnapshot>): void => {
		if (disposed) return; snapshot = Object.freeze({ ...snapshot, ...patch });
		for (const listener of listeners) listener();
	};
	const cancel = (): void => {
		++generation; abort?.abort(); abort = null;
		emit({ status: snapshot.supported ? 'ready' : 'idle', ...(snapshot.status === 'uploading'
			? { errorMessage: 'The upload was cancelled. The server may retain an unfinished project. Refresh the archive list before trying again.' } : {}) });
	};
	const operation = async (status: AudiocomArchiveSnapshot['status'], task: (signal: AbortSignal) => Promise<Partial<AudiocomArchiveSnapshot>>): Promise<void> => {
		if (!connected || disposed) return;
		cancel(); const current = generation; const selected = new AbortController(); abort = selected;
		emit({ status, errorMessage: undefined, completedFileName: undefined });
		try {
			const patch = await task(selected.signal);
			if (!disposed && connected && current === generation && !selected.signal.aborted) emit({ ...patch, status: 'ready' });
		} catch (error) {
			if (!disposed && connected && current === generation && !selected.signal.aborted) {
				if (error instanceof AudiocomApiError && error.status === 401) {
					connected = false; ++generation;
					savedProjects.clear();
					emit({ ...empty(), provider: snapshot.provider, errorMessage: error.message, status: 'error' });
					options.onAuthenticationExpired?.();
				} else emit({ status: 'error', errorMessage: error instanceof Error ? error.message : 'The project archive request failed.' });
			}
		} finally { if (abort === selected) abort = null; }
	};
	return {
		getSnapshot: () => snapshot,
		subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
		async initialize() {
			if (disposed || initialized) return;
			initialized = true;
			const current = generation;
			try {
				const capabilities = await client.capabilities();
				if (!disposed && current === generation) emit({ ...capabilities, supported: capabilities.formats.length > 0 });
			} catch { /* Account actions show any configuration or connection error. */ }
		},
		async setConnected(value) {
			if (disposed || connected === value) return;
			connected = value; cancel();
			if (!value) { savedProjects.clear(); emit({ ...empty(), provider: snapshot.provider, formats: snapshot.formats, maximumBytes: snapshot.maximumBytes }); return; }
			await operation('loading', async signal => {
				const capabilities = await client.capabilities(signal);
				return { ...capabilities, supported: capabilities.formats.length > 0 };
			});
		},
		async refresh(page) {
			if (!snapshot.supported || !Number.isSafeInteger(page) || page < 1) return;
			await operation('loading', async signal => {
				const listed = await client.list(page, signal); signal.throwIfAborted();
				for (const [localId, saved] of savedProjects) {
					const current = listed.results.find(project => project.id === saved.id);
					if (current) savedProjects.set(localId, current);
				}
				return listed;
			});
		},
		async saveProject(projectId, serialize) {
			if (!snapshot.supported || ['loading', 'uploading'].includes(snapshot.status)) return;
			await operation('uploading', async signal => {
				let revision = savedProjects.get(projectId);
				const cloudId = bindings.get(projectId);
				if (!revision && cloudId) {
					for (let page = 1; ; page++) {
						const listed = await client.list(page, signal); signal.throwIfAborted();
						revision = listed.results.find(project => project.id === cloudId);
						if (revision || !listed.hasNext) break;
					}
				}
				const format = 'aup3';
				const file = await serialize(format, signal); signal.throwIfAborted();
				if (file.size < 16 || file.size > snapshot.maximumBytes) throw new Error('The project archive exceeds the server size limit.');
				if (new TextDecoder().decode(await file.slice(0, 16).arrayBuffer()) !== 'SQLite format 3\0') throw new Error('The project archive is invalid.');
				signal.throwIfAborted();
				const name = revision?.name ?? (file.name.replace(/\.aup[34]$/iu, '').trim().slice(0, 256) || 'Project');
				const uploaded = await client.upload(file, name, signal, revision); signal.throwIfAborted();
				savedProjects.set(projectId, uploaded);
				bindings.set(projectId, uploaded.id);
				try { return { ...await client.list(1, signal), completedFileName: file.name }; }
				catch (error) {
					signal.throwIfAborted();
					if (error instanceof AudiocomApiError && error.status === 401) throw error;
					return { completedFileName: file.name, errorMessage: error instanceof Error
						? error.message : 'The project archive request failed.' };
				}
			});
		},
		cancel,
		dispose() { if (disposed) return; cancel(); disposed = true; connected = false; listeners.clear(); },
	};
}
