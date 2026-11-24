/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	discardWorkingProject, listTracktionProjects, publishTracktionProject, restoreTracktionProject,
	type TracktionVirtualFilesystem, type WorkingProject,
} from './tracktion-project-store.ts';

interface WasmRuntime {
	HEAPU8: Uint8Array;
	FS: TracktionVirtualFilesystem;
	_malloc(size: number): number;
	_free(pointer: number): void;
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
type CommandMessage = Readonly<{ id: number; request: ProjectCommand; input?: ArrayBuffer }>;
type NativeReply = Readonly<{ error?: string; detail?: string; value?: unknown }>;
type WorkerReply = NativeReply & Readonly<{ output?: ArrayBuffer }>;

const scope = globalThis as unknown as {
	location: Location;
	Module: WasmRuntime | WasmSettings;
	postMessage(reply: WorkerReply & Readonly<{ id: number }>, transfer?: Transferable[]): void;
	importScripts(url: string): void;
	onmessage: ((event: MessageEvent<CommandMessage>) => void) | null;
};
const core = new URL('edit-core.js', scope.location.href).href;
const encoder = new TextEncoder();
const assetId = /^[0-9a-f]{32}$/;
const maxCommandBytes = 64 * 1024;
const maxInputBytes = 16 * 1024 * 1024;
let completion: Readonly<{ id: number; resolve: (result: NativeReply) => void }> | undefined;
let failed: Error | undefined;
let activeProject: WorkingProject | undefined;

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
			const previous = activeProject;
			activeProject = next;
			if (previous) discardWorkingProject(runtime.FS, previous);
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
				if (!(input instanceof ArrayBuffer) || input.byteLength === 0 || input.byteLength > maxInputBytes) {
					throw new Error('The browser Tracktion core accepts imports up to 16 MiB');
				}
				runtime.FS.writeFile(path, new Uint8Array(input));
			}
		}
		if (request.kind === 'openArchive') return await openProject(runtime, message);
		const reply = await submit(runtime, message);
		if (reply.error) return reply;
		if (request.kind === 'save' && activeProject) {
			activeProject = await publishTracktionProject(runtime.FS, activeProject);
		}
		if (request.kind === 'close' && activeProject) {
			const previous = activeProject;
			activeProject = undefined;
			discardWorkingProject(runtime.FS, previous);
		}
		if (!exporting || !path) return reply;
		return { ...reply, output: Uint8Array.from(runtime.FS.readFile(path)).buffer };
	} finally {
		completion = undefined;
		if (path && runtime.FS.analyzePath(path).exists) runtime.FS.unlink(path);
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
