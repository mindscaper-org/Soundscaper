/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IPC } from '../../desktop/constants.js';
import { ReadCapabilityStore } from '../../desktop/file-capabilities.js';
import { registerFileCapabilityIpc } from '../../desktop/main-file-capability-ipc.mjs';
import { createProtocolHandler } from '../../desktop/protocol.js';
import { AtomicSaveManager, SaveTargetStore } from '../../desktop/save-targets.js';
import { SesxMediaSessionStore } from '../../desktop/sesx-media-session.mjs';
import { createAudioEditorFileService } from '../../src/common/editor/file-service.js';

interface SessionIpcOptions {
	readonly channels: typeof IPC;
	readonly desktopSmokeProbe: { resolveOpenPaths(): null; resolveSavePath(): null };
	readonly dialog: {
		showOpenDialog(window: unknown, request: Readonly<{ properties?: readonly string[] }>): Promise<{ canceled: boolean; filePaths: string[] }>;
		showSaveDialog(): Promise<never>;
	};
	handle(name: string, listener: (event: unknown, value: unknown) => unknown): void;
	opaqueId(value: unknown, length: number): string;
	ownerFor(): object;
	readonly pendingOpenProjects: { dispatch(): Promise<undefined> };
	readonly readCapabilities: ReadCapabilityStore;
	readonly saves: AtomicSaveManager;
	readonly saveTargets: SaveTargetStore;
	readonly sesxMediaSessions: SesxMediaSessionStore;
	windowFor(): null;
}
// This JS module infers its optional session argument from a null default.
// Its implementation uses these actual host ports; no session value is cast.
const registerSessionIpc = registerFileCapabilityIpc as unknown as (options: SessionIpcOptions) => void;

/** Only OS dialog/IPC transport are modeled; host capabilities, media grants and reads are real. */
export async function sesxDesktopHardwareFixture(xml: string, wave: Uint8Array) {
	const directory = await mkdtemp(join(tmpdir(), 'sesx-controller-custody-'));
	const sessionPath = join(directory, 'Selection.sesx');
	const reads = new ReadCapabilityStore(), targets = new SaveTargetStore();
	const saves = new AtomicSaveManager({ targets });
	const owner = {}, releasedReads: string[] = [], releasedSessions: string[] = [];
	const requests: Array<{ url: string; range: string | null; status: number }> = [];
	const dialog = {
		async showOpenDialog(_window: unknown, request: Readonly<{ properties?: readonly string[] }>) {
			assert.ok(!request.properties?.includes('openDirectory'), 'the selected session already has its physical adjacent media');
			return { canceled: false, filePaths: [sessionPath] };
		},
		async showSaveDialog() { assert.fail('Import must not ask for an output path'); },
	};
	const sessions = new SesxMediaSessionStore({ readCapabilities: reads, dialog, windowFor: () => null });
	const close = async () => {
		sessions.dispose(); await reads.dispose(); await saves.dispose(); targets.dispose();
		await rm(directory, { recursive: true, force: true });
	};
	try {
		await writeFile(sessionPath, xml); await writeFile(join(directory, 'Stereo.wav'), wave);
		const handlers = new Map<string, (event: unknown, value: unknown) => unknown>();
		registerSessionIpc({ channels: IPC, desktopSmokeProbe: { resolveOpenPaths: () => null, resolveSavePath: () => null },
			dialog, handle: (name: string, listener: (event: unknown, value: unknown) => unknown) => { handlers.set(name, listener); },
			opaqueId: (value: unknown, length: number) => {
				const id = String(value || '');
				if (id.length !== length || !/^[a-f0-9]+$/u.test(id)) throw new TypeError('Invalid opaque identifier');
				return id;
			}, ownerFor: () => owner,
			pendingOpenProjects: { dispatch: async () => undefined }, readCapabilities: reads, saves, saveTargets: targets,
			sesxMediaSessions: sessions, windowFor: () => null });
		const invoke = async (name: string, value: unknown): Promise<unknown> => {
			const listener = handlers.get(name); assert.ok(listener); return await listener({}, value);
		};
		const protocol = createProtocolHandler({ productId: 'soundscaper', rendererRoot: directory, runtimeRoot: directory, readCapabilities: reads });
		const fileService = createAudioEditorFileService({ bridge: {
			chooseFiles: (request: unknown) => invoke(IPC.chooseFiles, request),
			resolveSesxMedia: (request: unknown) => invoke(IPC.sesxResolveMedia, request),
			chooseSesxMediaFolder: (request: unknown) => invoke(IPC.sesxChooseFolder, request),
			releaseSesxSession: async (id: string) => { releasedSessions.push(id); return await invoke(IPC.sesxReleaseSession, id); },
			releaseRead: async (id: string) => { releasedReads.push(id); return await invoke(IPC.releaseRead, id); },
		}, fetch: async (url: string, options?: RequestInit) => {
			const request = new Request(url, options), response = await protocol(request);
			requests.push({ url, range: request.headers.get('Range'), status: response.status }); return response;
		} });
		return { fileService, requests, releasedReads, releasedSessions, close };
	} catch (error) { await close(); throw error; }
}
