/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TracktionAudioBuffers } from '../../../src/soundscaper/tracktion-audio-queue.ts';
import { requireTracktionWebUpload } from '../../../src/soundscaper/tracktion-web-upload.ts';

import { TracktionHostedAudio, type HostedAudioRuntime } from './tracktion-hosted-audio.ts';

import {
	discardWorkingProject, listTracktionProjects, publishTracktionProject, restoreTracktionProject,
	type TracktionVirtualFilesystem, type WorkingProject,
} from './tracktion-project-store.ts';

interface WasmRuntime extends HostedAudioRuntime {
	FS: TracktionVirtualFilesystem;
	_soundscaper_submit(id: number, pointer: number, length: number): number;
	UTF8ToString(pointer: number): string;
}

interface WasmSettings {
	mainScriptUrlOrBlob: string;
	tracktionReady(): void;
	tracktionCompleted(id: number, pointer: number): void;
	onAbort(reason: unknown): void;
}

type ProjectCommand = Readonly<{ kind: string; asset?: string }> & Readonly<Record<string, unknown>>;
type CommandMessage = Readonly<{ id: number; request: ProjectCommand; input?: ArrayBuffer; audio?: TracktionAudioBuffers }>;
type NativeReply = Readonly<{ error?: string; detail?: string; value?: unknown }>;
type WorkerReply = NativeReply & Readonly<{ output?: ArrayBuffer }>;

const scope = globalThis as unknown as {
	location: Location;
	Module: WasmRuntime | WasmSettings;
	postMessage(reply: (WorkerReply & Readonly<{ id: number }>) | Readonly<{ fatal: string }>, transfer?: Transferable[]): void;
	importScripts(url: string): void;
	onmessage: ((event: MessageEvent<CommandMessage>) => void) | null;
};
const core = new URL('edit-core.js', scope.location.href).href;
const encoder = new TextEncoder();
const assetId = /^[0-9a-f]{32}$/;
const maxCommandBytes = 64 * 1024;
let completion: Readonly<{ id: number; resolve: (result: NativeReply) => void }> | undefined;
let failed: Error | undefined;
let activeProject: WorkingProject | undefined;
let activeAudio: TracktionHostedAudio | undefined;

const ready = new Promise<void>((resolve) => {
	scope.Module = {
		mainScriptUrlOrBlob: core,
		tracktionReady: resolve,
		tracktionCompleted(id, pointer) {
			const runtime = scope.Module as WasmRuntime;
			try {
				if (completion?.id === id) completion.resolve(pointer === 0
					? { error: 'host', detail: 'Tracktion ran out of memory' }
					: JSON.parse(runtime.UTF8ToString(pointer)) as NativeReply);
			} catch (error) {
				completion?.resolve(hostError(error));
			} finally {
				if (pointer !== 0) runtime._free(pointer);
			}
		},
		onAbort(reason) {
			failed = new Error(String(reason));
			scope.postMessage({ fatal: failed.message });
			completion?.resolve({ error: 'host', detail: failed.message });
			resolve();
		},
	};
});

function submit(runtime: WasmRuntime, { id, request }: CommandMessage): Promise<NativeReply> {
	const bytes = encoder.encode(JSON.stringify(request));
	if (bytes.length === 0 || bytes.length > maxCommandBytes) throw new Error('The Tracktion command is oversized');
	return new Promise((resolve, reject) => {
		const pointer = runtime._malloc(bytes.length);
		if (pointer === 0) throw new Error('Tracktion ran out of memory');
		try {
			runtime.HEAPU8.set(bytes, pointer);
			completion = { id, resolve };
			if (runtime._soundscaper_submit(id, pointer, bytes.length) === 0) reject(new Error('Tracktion rejected the command'));
		} finally {
			runtime._free(pointer);
		}
	});
}

function hostError(error: unknown): NativeReply {
	return { error: 'host', detail: error instanceof Error ? error.message : String(error) };
}

function stopAudio(): void {
	activeAudio?.stop();
	activeAudio = undefined;
}

async function runTransport(runtime: WasmRuntime, message: CommandMessage): Promise<NativeReply> {
	const { kind, discard } = message.request;
	if (kind === 'startRecording' && !message.audio?.capture) throw new Error('Tracktion requires browser microphone audio');
	if (kind === 'finishRecording') {
		activeAudio?.pause();
		if (!discard) await activeAudio?.drain();
	}
	const next = message.audio && new TracktionHostedAudio(runtime, message.audio);
	let adopted = false;
	try {
		const reply = await submit(runtime, message);
		if (reply.error) return reply;
		stopAudio();
		const status = reply.value as { playing?: boolean; recording?: boolean } | undefined;
		if (next && (status?.playing || status?.recording)) {
			next.start();
			activeAudio = next;
			adopted = true;
		}
		return reply;
	} finally {
		if (!adopted) next?.stop();
	}
}

async function openProject(runtime: WasmRuntime, message: CommandMessage): Promise<NativeReply> {
	const { request } = message;
	if (typeof request.project !== 'string' || !assetId.test(request.project)) {
		throw new Error('The browser Tracktion project handle is invalid');
	}
	const { name, ...native } = request;
	if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0 || name.length > 128)) {
		throw new Error('The browser Tracktion project name is invalid');
	}
	let next: WorkingProject = {
		id: request.project, directory: crypto.randomUUID().replaceAll('-', ''), generation: 0,
		name: name?.trim() ?? 'Untitled project',
	};
	try {
		if (request.kind === 'open') next = await restoreTracktionProject(runtime.FS, next);
		const reply = await submit(runtime, { ...message, request: { ...native, project: next.directory } });
		if (!reply.error) {
			stopAudio();
			const previous = activeProject;
			activeProject = next;
			if (previous) discardWorkingProject(runtime.FS, previous);
			// Warm the native graph while opening the project. The AudioContext
			// remains owned by the renderer and still starts on the Play gesture.
			await submit(runtime, { id: message.id, request: { kind: 'prepareOutput' } }).catch(() => undefined);
		}
		return reply;
	} finally {
		if (activeProject !== next) discardWorkingProject(runtime.FS, next);
	}
}

async function run(message: CommandMessage): Promise<WorkerReply> {
	const { request, input } = message;
	if (request.kind === 'projects') return { value: await listTracktionProjects() };
	await ready;
	if (failed) throw failed;
	const runtime = scope.Module as WasmRuntime;
	const archive = request.kind === 'archive' || request.kind === 'openArchive';
	const importing = request.kind === 'import' || request.kind === 'importFile' || request.kind === 'openArchive';
	const exporting = request.kind === 'render' || request.kind === 'archive';
	let path: string | undefined;
	try {
		if (request.kind === 'create' || request.kind === 'open') return await openProject(runtime, message);
		if (importing || exporting) {
			if (!request.asset || !assetId.test(request.asset)) throw new Error('The Tracktion asset handle is invalid');
			const directory = importing ? '/exchange/input' : '/exchange/output';
			path = `${directory}/${request.asset}${archive ? '.zip' : '.wav'}`;
			runtime.FS.mkdirTree(directory);
			if (importing) {
				if (!(input instanceof ArrayBuffer)) throw new Error('The Tracktion import did not contain a file');
				requireTracktionWebUpload(input.byteLength, archive ? 'ZIP' : 'WAV');
				runtime.FS.writeFile(path, new Uint8Array(input));
			}
		}
		if (request.kind === 'openArchive') return await openProject(runtime, message);
		if (request.kind === 'stop' || request.kind === 'seek' || request.kind === 'play' || request.kind === 'close'
			|| request.kind === 'startRecording' || request.kind === 'finishRecording') {
			const transportReply = await runTransport(runtime, message);
			if (request.kind !== 'close' || transportReply.error) return transportReply;
			if (activeProject) discardWorkingProject(runtime.FS, activeProject);
			activeProject = undefined;
			return transportReply;
		}
		const reply = await submit(runtime, message);
		if (reply.error) return reply;
		if (request.kind === 'save' && activeProject) {
			activeProject = await publishTracktionProject(runtime.FS, activeProject);
		}
		if (!exporting || !path) return reply;
		// WASMFS normally returns a dedicated JavaScript buffer ready for transfer.
		const bytes = runtime.FS.readFile(path);
		const output = bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
			? bytes.buffer : Uint8Array.from(bytes).buffer;
		return { ...reply, output };
	} finally {
		completion = undefined;
		if (path && runtime.FS.findObject(path)) runtime.FS.unlink(path);
	}
}

let queue = Promise.resolve();
scope.onmessage = ({ data }) => {
	queue = queue.then(async () => {
		const reply = await run(data);
		scope.postMessage({ id: data.id, ...reply }, reply.output ? [reply.output] : []);
	}).catch((error: unknown) => {
		scope.postMessage({ id: data.id, ...hostError(error) });
	});
};
scope.importScripts(core);
