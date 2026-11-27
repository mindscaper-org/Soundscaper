/* SPDX-License-Identifier: AGPL-3.0-only */

import { PROJECT_COMMAND_COPY_BY_LOCALE } from '../common/i18n/project-command-copy.js';

import type { TracktionAudioBuffers } from './tracktion-audio-queue.ts';
import type {
	TracktionOpenedProject, TracktionProjectBridge, TracktionProjectCommand, TracktionProjectPage, TracktionProjectReply,
	TracktionTransportView,
} from './tracktion-project-contract.ts';
import { TracktionWebAudio } from './tracktion-web-audio.ts';
import { requireTracktionWebUpload } from './tracktion-web-upload.ts';

type LocalProject = Readonly<{ id: string; name: string }>;
type WorkerReply = Readonly<{ id: number; value?: unknown; output?: ArrayBuffer; error?: string; detail?: string }>;
type WorkerMessage = WorkerReply | Readonly<{ fatal: string }>;
type Reply = TracktionProjectReply<TracktionProjectCommand>;

const copy = PROJECT_COMMAND_COPY_BY_LOCALE.en;
const handle = () => crypto.randomUUID().replaceAll('-', '');

export function createTracktionWebBridge(createWorker: () => Worker): TracktionProjectBridge {
	const pending = new Map<number, Readonly<{ resolve(reply: WorkerReply): void; reject(error: Error): void }>>();
	const audio = new TracktionWebAudio();
	let project: Readonly<{ sessionId: string; name: string; sampleRate: number }> | undefined;
	let sequence = 0;
	let worker: Worker | undefined;
	const interruptionListeners = new Set<() => void>();
	const projectLossListeners = new Set<(sessionId: string, message: string) => void>();

	function retireWorker(opened: Worker, error: Error): void {
		if (worker !== opened) return;
		worker = undefined;
		opened.terminate();
		for (const request of pending.values()) request.reject(error);
		const lost = project;
		project = undefined;
		void audio.close().catch(() => undefined);
		if (lost) {
			for (const listener of projectLossListeners) listener(lost.sessionId, error.message);
		}
	}

	function startWorker(): Worker {
		const opened = createWorker();
		opened.addEventListener('message', ({ data }: MessageEvent<WorkerMessage>) => {
			if (opened !== worker) return;
			if ('fatal' in data) {
				retireWorker(opened, new Error(data.fatal));
				return;
			}
			const request = pending.get(data.id);
			if (!request) return;
			if (data.error) request.reject(new Error(data.detail ?? data.error));
			else request.resolve(data);
		});
		opened.addEventListener('error', (event) => {
			retireWorker(opened, new Error(event.message || 'The Tracktion browser worker stopped'));
		});
		return opened;
	}

	async function send(request: Readonly<Record<string, unknown>>, input?: ArrayBuffer, buffers?: TracktionAudioBuffers): Promise<WorkerReply> {
		const engine = worker ??= startWorker();
		const id = ++sequence;
		let deadline: number | undefined;
		try {
			return await new Promise((resolve, reject) => {
				pending.set(id, { resolve, reject });
				deadline = window.setTimeout(() => {
					retireWorker(engine, new Error('The Tracktion browser worker did not respond'));
				}, 60_000);
				engine.postMessage({ id, request, input, audio: buffers }, input ? [input] : []);
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
		const current = project;
		const sendToProject = async (message: Readonly<Record<string, unknown>>, input?: ArrayBuffer, buffers?: TracktionAudioBuffers) => {
			if (project !== current) throw new Error('This Tracktion project handle has expired');
			return await send(message, input, buffers);
		};
		if (request.kind === 'prepareOutput') {
			const [, reply] = await Promise.all([audio.prepare(current.sampleRate), sendToProject(request)]);
			return reply.value;
		}
		if (request.kind === 'play' || (request.kind === 'seek' && audio.playing)) {
			const buffers = { output: audio.outputBuffer() };
			const { value } = await sendToProject(request, undefined, buffers);
			try {
				if ((value as TracktionTransportView).playing) audio.connect(buffers);
				else audio.stop();
			} catch (error) {
				audio.stop();
				await sendToProject({ kind: 'stop' }).catch(() => undefined);
				throw error;
			}
			return value;
		}
		if (request.kind === 'startRecording') {
			if (audio.playing) throw new Error('Stop browser audio before starting a Tracktion recording');
			let started = false;
			try {
				const buffers = await audio.microphoneBuffers(current.sampleRate);
				const { value } = await sendToProject(request, undefined, buffers);
				started = (value as TracktionTransportView).recording;
				if (!started) throw new Error('Tracktion could not start recording');
				audio.connect(buffers, () => {
					for (const listener of interruptionListeners) listener();
				});
				return value;
			} catch (error) {
				audio.stop();
				if (started) await sendToProject({ kind: 'finishRecording', revision: request.revision, discard: true }).catch(() => undefined);
				throw error;
			}
		}
		if (request.kind === 'finishRecording') {
			audio.sealCapture();
			const { value } = await sendToProject(request);
			audio.stop();
			return value;
		}

		if (request.kind === 'import') {
			const wave = await chooseFile('.wav,audio/wav');
			if (!wave) return null;
			requireTracktionWebUpload(wave.size, 'WAV');
			return (await sendToProject({ ...request, kind: 'importFile', asset: handle(), name: wave.name.replace(/\.wav$/iu, '') }, await wave.arrayBuffer())).value;
		}
		if (request.kind === 'render' || request.kind === 'archive') {
			const reply = await sendToProject({ ...request, asset: handle() });
			if (!reply.output) throw new Error('The Tracktion browser worker did not return a file');
			download(reply.output, current.name, request.kind === 'archive' ? 'zip' : 'wav');
			return reply.value;
		}
		const reply = await sendToProject(request);
		if (request.kind === 'stop') audio.stop();
		if (request.kind !== 'close') return reply.value;
		project = undefined;
		await audio.close();
		return null;
	}

	async function describeOpened(name: string, value: unknown, initiallyUnsaved: boolean): Promise<TracktionOpenedProject> {
		const opened = worker;
		await audio.close();
		if (!opened || worker !== opened) throw new Error('The Tracktion browser worker stopped while opening the project');
		const page = value as TracktionProjectPage;
		const sessionId = handle();
		project = { sessionId, name, sampleRate: page.sampleRate };
		return { sessionId, name, project: page, initiallyUnsaved };
	}

	return {
		async request<Command extends TracktionProjectCommand>(command: Command): Promise<TracktionProjectReply<Command>> {
			return await execute(command) as Reply as TracktionProjectReply<Command>;
		},
		onRecordingInterrupted(listener) {
			interruptionListeners.add(listener);
			return () => { interruptionListeners.delete(listener); };
		},
		onProjectLost(listener) {
			projectLossListeners.add(listener);
			return () => { projectLossListeners.delete(listener); };
		},
		async openArchive(): Promise<TracktionOpenedProject | null> {
			const archive = await chooseFile('.zip,application/zip');
			if (!archive) return null;
			requireTracktionWebUpload(archive.size, 'ZIP');
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
