/* SPDX-License-Identifier: AGPL-3.0-only */

import { PROJECT_COMMAND_COPY_BY_LOCALE } from '../common/i18n/project-command-copy.js';

import type {
	TracktionOpenedProject, TracktionProjectBridge, TracktionProjectCommand, TracktionProjectPage, TracktionProjectReply,
	TracktionTransportView,
} from './tracktion-project-contract.ts';
import { TracktionWebAudio } from './tracktion-web-audio.ts';

type LocalProject = Readonly<{ id: string; name: string }>;
type WorkerReply = Readonly<{ id: number; value?: unknown; output?: ArrayBuffer; error?: string; detail?: string }>;
type Reply = TracktionProjectReply<TracktionProjectCommand>;

const copy = PROJECT_COMMAND_COPY_BY_LOCALE.en;
const handle = () => crypto.randomUUID().replaceAll('-', '');

export function createTracktionWebBridge(worker: Worker): TracktionProjectBridge {
	const pending = new Map<number, Readonly<{ resolve(reply: WorkerReply): void; reject(error: Error): void }>>();
	const audio = new TracktionWebAudio();
	let project: Readonly<{ sessionId: string; name: string; sampleRate: number }> | undefined;
	let sequence = 0;
	let failure: Error | undefined;

	worker.addEventListener('message', ({ data }: MessageEvent<WorkerReply>) => {
		const request = pending.get(data.id);
		if (!request) return;
		if (data.error) request.reject(new Error(data.detail ?? data.error));
		else request.resolve(data);
	});
	worker.addEventListener('error', (event) => {
		failure = new Error(event.message || 'The Tracktion browser worker stopped');
		audio.stop();
		worker.terminate();
		for (const request of pending.values()) request.reject(failure);
	});

	async function send(request: Readonly<Record<string, unknown>>, input?: ArrayBuffer, shared?: SharedArrayBuffer): Promise<WorkerReply> {
		if (failure) throw failure;
		const id = ++sequence;
		let deadline: number | undefined;
		try {
			return await new Promise((resolve, reject) => {
				pending.set(id, { resolve, reject });
				deadline = window.setTimeout(() => {
					failure = new Error('The Tracktion browser worker did not respond');
					audio.stop();
					worker.terminate();
					for (const request of pending.values()) request.reject(failure);
				}, 60_000);
				worker.postMessage({ id, request, input, audio: shared }, input ? [input] : []);
			});
		} finally {
			window.clearTimeout(deadline);
			pending.delete(id);
		}
	}

	async function execute(command: TracktionProjectCommand): Promise<unknown> {
		if (command.kind === 'create' || command.kind === 'open') {
			const selection = command.kind === 'create'
				? { id: handle(), name: window.prompt(copy.projectName, copy.untitledProject)?.trim() }
				: await chooseProject((await send({ kind: 'projects' })).value as readonly LocalProject[]);
			if (!selection?.name) return null;
			const request = { ...command, project: selection.id };
			const { value } = await send(command.kind === 'create' ? { ...request, name: selection.name } : request);
			return await describeOpened(selection.name, value, command.kind === 'create');
		}

		const { sessionId, ...request } = command;
		if (project?.sessionId !== sessionId) throw new Error('This Tracktion project handle has expired');
		if (request.kind === 'prepareOutput') await audio.prepare(project.sampleRate);
		if (request.kind === 'play' || (request.kind === 'seek' && audio.playing)) {
			const shared = audio.buffer();
			const { value } = await send(request, undefined, shared);
			try {
				if ((value as TracktionTransportView).playing) audio.connect(shared);
				else audio.stop();
			} catch (error) {
				audio.stop();
				await send({ kind: 'stop' }).catch(() => undefined);
				throw error;
			}
			return value;
		}
		if (request.kind === 'import') {
			const wave = await chooseFile('.wav,audio/wav');
			if (!wave) return null;
			if (wave.size > 16 * 1024 * 1024) throw new Error('The browser Tracktion core accepts WAV files up to 16 MiB');
			return (await send({ ...request, kind: 'importFile', asset: handle(), name: wave.name.replace(/\.wav$/iu, '') }, await wave.arrayBuffer())).value;
		}
		if (request.kind === 'render' || request.kind === 'archive') {
			const reply = await send({ ...request, asset: handle() });
			if (!reply.output) throw new Error('The Tracktion browser worker did not return a file');
			download(reply.output, project.name, request.kind === 'archive' ? 'zip' : 'wav');
			return reply.value;
		}
		if (request.kind === 'stop') audio.stop();
		const reply = await send(request);
		if (request.kind !== 'close') return reply.value;
		project = undefined;
		await audio.close();
		return null;
	}

	async function describeOpened(name: string, value: unknown, initiallyUnsaved: boolean): Promise<TracktionOpenedProject> {
		await audio.close();
		const page = value as TracktionProjectPage;
		const sessionId = handle();
		project = { sessionId, name, sampleRate: page.sampleRate };
		return { sessionId, name, project: page, initiallyUnsaved };
	}

	return {
		async request<Command extends TracktionProjectCommand>(command: Command): Promise<TracktionProjectReply<Command>> {
			return await execute(command) as Reply as TracktionProjectReply<Command>;
		},
		async openArchive(): Promise<TracktionOpenedProject | null> {
			const archive = await chooseFile('.zip,application/zip');
			if (!archive) return null;
			if (archive.size > 16 * 1024 * 1024) throw new Error('The browser Tracktion core accepts ZIP files up to 16 MiB');
			const name = archive.name.replace(/\.zip$/iu, '').slice(0, 128).trim() || copy.untitledProject;
			const { value } = await send({ kind: 'openArchive', project: handle(), name, asset: handle() }, await archive.arrayBuffer());
			return await describeOpened(name, value, true);
		},
	};
}

function chooseFile(accept: string): Promise<File | null> {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = accept;
		input.hidden = true;
		function finish(): void {
			const file = input.files?.[0] ?? null;
			input.remove();
			resolve(file);
		}
		input.addEventListener('change', finish, { once: true });
		input.addEventListener('cancel', finish, { once: true });
		document.body.append(input);
		input.click();
	});
}

function chooseProject(projects: readonly LocalProject[]): Promise<LocalProject | null> {
	const dialog = document.createElement('dialog');
	const heading = document.createElement('h2');
	heading.textContent = copy.projectsTitle;
	dialog.setAttribute('aria-label', copy.projectsTitle);
	const form = document.createElement('form');
	form.method = 'dialog';
	for (const project of projects) {
		const button = document.createElement('button');
		button.textContent = project.name;
		button.value = project.id;
		form.append(button);
	}
	if (!projects.length) {
		const empty = document.createElement('p');
		empty.textContent = copy.noProjects;
		form.append(empty);
	}
	const cancel = document.createElement('button');
	cancel.textContent = copy.cancel;
	form.append(cancel);
	dialog.append(heading, form);
	return new Promise((resolve) => {
		dialog.addEventListener('close', () => {
			dialog.remove();
			resolve(projects.find((project) => project.id === dialog.returnValue) ?? null);
		}, { once: true });
		document.body.append(dialog);
		dialog.showModal();
	});
}

function download(bytes: ArrayBuffer, name: string, extension: 'wav' | 'zip'): void {
	const url = URL.createObjectURL(new Blob([bytes], { type: extension === 'wav' ? 'audio/wav' : 'application/zip' }));
	const link = document.createElement('a');
	link.download = `${name}.${extension}`;
	link.href = url;
	link.hidden = true;
	document.body.append(link);
	link.click();
	window.setTimeout(() => {
		link.remove();
		URL.revokeObjectURL(url);
	}, 30_000);
}
