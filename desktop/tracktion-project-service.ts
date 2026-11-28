/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { lstat, mkdir, mkdtemp, realpath, rm, rmdir } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type {
	TracktionOpenedProject, TracktionProjectCommand, TracktionProjectReply,
} from '../src/soundscaper/tracktion-project-contract.ts';
import type { TracktionAudioPreferences } from './tracktion-audio-preferences.ts';
import type { TracktionPluginLibrary } from './tracktion-plugin-library.ts';
import { TracktionRejectedCommand, type TracktionCommand, type TracktionReply } from './tracktion-peer-contract.ts';
import { createTracktionExportWriter, stageTracktionWave } from './tracktion-project-files.ts';
import { readTracktionProjectRequest } from './tracktion-project-request.ts';

interface TracktionProjectPeer {
	request<Command extends TracktionCommand>(command: Command): Promise<TracktionReply<Command>>;
	close(): Promise<void>;
	readonly completion?: Promise<void>;
	readonly stopped?: boolean;
}

type LaunchMode = Readonly<{ mode: 'create'; sampleRate: number }> | Readonly<{ mode: 'open' }>;
type ProjectLaunch = LaunchMode & Readonly<{
	projectDirectory: string;
	stateDirectory: string;
	exchangeDirectory: string;
	clipboardDirectory: string;
}>;

interface Ports {
	readonly scratchRoot: string;
	readonly audioPreferences?: TracktionAudioPreferences;
	readonly pluginLibrary?: TracktionPluginLibrary;
	readonly isOwnerCurrent: (owner: object) => boolean;
	readonly chooseCreateDirectory: () => Promise<string | null>;
	readonly chooseOpenProject: () => Promise<string | null>;
	readonly chooseWave: () => Promise<string | null>;
	readonly chooseExport: (format: 'wav' | 'zip') => Promise<string | null>;
	readonly startPeer: (launch: ProjectLaunch) => Promise<TracktionProjectPeer>;
	readonly onProjectLost?: (owner: object, sessionId: string, message: string) => void;
}

type Reply = TracktionProjectReply<TracktionProjectCommand>;
type OpeningCommand = Extract<TracktionProjectCommand, { kind: 'open' | 'create' }>;
type ActiveCommand = Exclude<TracktionProjectCommand, OpeningCommand>;

interface ActiveProject {
	readonly owner: object;
	readonly id: string;
	readonly directory: string;
	readonly scratch: string;
	readonly exchange: string;
	readonly peer: TracktionProjectPeer;
	audioPreferencesApplied: boolean;
	savedRevision: number;
	savedEdit: string | null;
}

interface Operation {
	readonly owner: object;
	readonly sessionId: string | null;
	readonly controller: AbortController;
	readonly result: Promise<Reply>;
}

const EDIT_FILE = 'project.tracktionedit';
const UTILITY_EXIT_MESSAGE = 'The Tracktion audio engine stopped unexpectedly. Reopen your saved project to continue.';

/** Main-side lifetime and file authority for one experimental Soundscaper editor window. */
export class TracktionProjectService {
	readonly #ports: Ports;
	readonly #revoked = new WeakSet<object>();
	readonly #exports = createTracktionExportWriter();
	readonly #deferredEditScratch = new Set<string>();
	#active: ActiveProject | null = null;
	#clipboard: Readonly<{ owner: object; directory: string }> | null = null;
	#operation: Operation | null = null;
	#closing = false;
	#disposal: Promise<void> | null = null;

	constructor(ports: Ports) { this.#ports = ports; }

	async request(owner: object, value: unknown): Promise<Reply> {
		const command = readTracktionProjectRequest(value);
		this.#assertOwner(owner);
		if (this.#operation) throw new Error('A Tracktion project command is already in progress.');

		const controller = new AbortController();
		const operation = {
			owner, controller,
			sessionId: 'sessionId' in command ? command.sessionId : null,
			result: Promise.resolve().then(() => this.#execute(owner, command, controller.signal)),
		};
		this.#operation = operation;
		try {
			const result = await operation.result;
			this.#assertOwner(owner, controller.signal);
			return result;
		} finally {
			if (this.#operation === operation) this.#operation = null;
		}
	}

	revokeOwner(owner: object): Promise<void> {
		this.#revoked.add(owner);
		const running = this.#operation?.owner === owner ? this.#operation : null;
		running?.controller.abort(new Error('This Tracktion editor window was replaced.'));
		const active = this.#active?.owner === owner ? this.#active : null;
		if (active) this.#active = null;
		return this.#retireOwner(owner, active, running);
	}

	dispose(): Promise<void> {
		if (this.#disposal) return this.#disposal;
		this.#closing = true;
		const owners = new Set([this.#operation?.owner, this.#active?.owner, this.#clipboard?.owner]);
		this.#disposal = Promise.allSettled([...owners].flatMap((owner) => owner ? [this.revokeOwner(owner)] : []))
			.then(async (results) => {
				await Promise.all([...this.#deferredEditScratch].map((scratch) => this.#removeEditScratch(scratch)));
				await this.#exports.dispose();
				for (const result of results) if (result.status === 'rejected') throw result.reason;
			});
		return this.#disposal;
	}

	async #retireOwner(owner: object, active: ActiveProject | null, running: Operation | null): Promise<void> {
		const results = await Promise.allSettled([
			active?.peer.close(),
			running?.result.catch(() => undefined),
			this.#exports.revokeOwner(owner),
		]);
		if (active) await this.#removeEditScratch(active.scratch);
		if (this.#clipboard?.owner === owner) {
			const { directory } = this.#clipboard;
			this.#clipboard = null;
			await rm(directory, { force: true, recursive: true });
		}
		for (const result of results) if (result.status === 'rejected') throw result.reason;
	}

	async #removeEditScratch(scratch: string): Promise<void> {
		try {
			await rm(scratch, { force: true, recursive: true });
			this.#deferredEditScratch.delete(scratch);
		} catch (error) {
			if (!this.#deferredEditScratch.has(scratch)) console.error('Could not remove retired Tracktion session files.', error);
			this.#deferredEditScratch.add(scratch);
		}
	}

	async #closeProject(active: ActiveProject): Promise<void> {
		try { await active.peer.close(); }
		finally { await this.#removeEditScratch(active.scratch); }
	}

	#assertOwner(owner: object, signal?: AbortSignal): void {
		signal?.throwIfAborted();
		if (this.#closing || this.#revoked.has(owner) || !this.#ports.isOwnerCurrent(owner)) {
			throw new Error('The Tracktion editor window is no longer current.');
		}
	}

	#requireProject(owner: object, id: string): ActiveProject {
		const active = this.#active;
		if (!active || active.owner !== owner || active.id !== id) {
			throw new Error('This Tracktion project handle has expired.');
		}
		return active;
	}

	#observeProjectExit(active: ActiveProject): void {
		void active.peer.completion?.then(async () => {
			if (this.#active !== active) return;
			this.#active = null;
			const operation = this.#operation?.sessionId === active.id ? this.#operation : null;
			operation?.controller.abort(new Error(UTILITY_EXIT_MESSAGE));
			try {
				if (this.#ports.isOwnerCurrent(active.owner)) this.#ports.onProjectLost?.(active.owner, active.id, UTILITY_EXIT_MESSAGE);
			} finally {
				await operation?.result.catch(() => undefined);
				await this.#closeProject(active);
			}
		}).catch(console.error);
	}

	async #execute(owner: object, command: TracktionProjectCommand, signal: AbortSignal): Promise<Reply> {
		this.#assertOwner(owner, signal);
		if (command.kind === 'create' || command.kind === 'open') return this.#open(owner, command, signal);
		const active = this.#requireProject(owner, command.sessionId);
		if (command.kind === 'close') {
			this.#active = null;
			await this.#closeProject(active);
			return null;
		}
		if (command.kind === 'save') {
			const currentEdit = await readEditVersion(active.directory);
			this.#assertOwner(owner, signal);
			if (currentEdit !== null && currentEdit !== active.savedEdit) {
				throw new Error('The Tracktion project file changed on disk. Open the project again to load the latest version.');
			}
			const saved = await active.peer.request(withoutSession(command));
			active.savedEdit = await readEditVersion(active.directory);
			active.savedRevision = saved.revision;
			return saved;
		}
		if (command.kind === 'import') return this.#import(active, command, signal);
		if (command.kind === 'render' || command.kind === 'archive') return this.#export(active, command, signal);
		if (command.kind === 'offlineEffectCatalog') return await this.#ports.pluginLibrary?.catalog() ?? null;
		if (command.kind === 'scanOfflineEffects') return await this.#ports.pluginLibrary?.scan(owner, signal) ?? null;
		if (command.kind === 'addOfflineEffect') {
			const identity = await this.#ports.pluginLibrary?.select(command.installationId, signal);
			this.#assertOwner(owner, signal);
			if (!identity) return { revision: command.revision, itemId: null };
			return active.peer.request({ kind: 'insertOfflineEffect', trackId: command.trackId, revision: command.revision, ...identity });
		}
		if (command.kind === 'audioHosts') {
			const hosts = await active.peer.request({ kind: 'audioHosts' });
			return { ...hosts, preferred: await this.#ports.audioPreferences?.read() ?? null };
		}
		if (command.kind === 'setAudioSetup') {
			const applied = await active.peer.request(withoutSession(command));
			active.audioPreferencesApplied = true;
			this.#assertOwner(owner, signal);
			try {
				await this.#ports.audioPreferences?.write(applied.setup);
			} catch {
				return { ...applied, preferencesSaved: false };
			}
			return applied;
		}
		if (!active.audioPreferencesApplied && (command.kind === 'prepareOutput' || command.kind === 'startRecording')) {
			const preferences = await this.#ports.audioPreferences?.read();
			this.#assertOwner(owner, signal);
			if (preferences) await active.peer.request({ kind: 'useAudioProfile', ...preferences });
			this.#assertOwner(owner, signal);
			active.audioPreferencesApplied = true;
		}

		return active.peer.request(withoutSession(command));
	}

	async #open(owner: object, command: OpeningCommand, signal: AbortSignal): Promise<TracktionOpenedProject | null> {
		const selection = command.kind === 'create'
			? await this.#ports.chooseCreateDirectory()
			: await this.#ports.chooseOpenProject();
		this.#assertOwner(owner, signal);
		if (selection === null) return null;

		const directory = await selectedProjectDirectory(selection, command.kind);
		const previous = this.#active;
		const selectedEdit = command.kind === 'open' ? await readEditVersion(directory) : null;
		this.#assertOwner(owner, signal);
		if (selectedEdit !== null && previous?.owner === owner && previous.directory === directory
			&& previous.savedEdit === selectedEdit && this.#active === previous) {
			const current = await describe(previous);
			if (current.project.revision === previous.savedRevision && selectedEdit === await readEditVersion(directory)
				&& this.#active === previous) return current;
		}

		await mkdir(this.#ports.scratchRoot, { recursive: true, mode: 0o700 });
		const scratchRoot = await realpath(this.#ports.scratchRoot);
		const scratch = await mkdtemp(join(scratchRoot, 'edit-'));
		const exchange = join(scratch, 'exchange');
		let candidate: ActiveProject | null = null;
		try {
			await Promise.all(['input', 'output'].map((direction) => mkdir(join(exchange, direction), { recursive: true, mode: 0o700 })));
			this.#assertOwner(owner, signal);
			if (this.#clipboard && this.#clipboard.owner !== owner) throw new Error('The Tracktion clipboard belongs to a different editor window.');
			this.#clipboard ??= { owner, directory: await mkdtemp(join(scratchRoot, 'clipboard-')) };
			this.#assertOwner(owner, signal);
			const location = { projectDirectory: directory, stateDirectory: join(scratch, 'state'),
				exchangeDirectory: exchange, clipboardDirectory: this.#clipboard.directory };
			const peer = await this.#ports.startPeer(command.kind === 'create'
				? { ...location, mode: 'create', sampleRate: command.sampleRate }
				: { ...location, mode: 'open' });
			candidate = { owner, directory, scratch, exchange, peer, audioPreferencesApplied: false,
				savedRevision: 0, savedEdit: selectedEdit, id: randomBytes(16).toString('hex') };
			this.#assertOwner(owner, signal);
			const opened = await describe(candidate);
			this.#assertOwner(owner, signal);
			if (command.kind === 'create') await saveNewProject(candidate);
			const openedEdit = await readEditVersion(directory);
			if (command.kind === 'open' && openedEdit !== selectedEdit) {
				throw new Error('The Tracktion project file changed while it was being opened. Open the project again.');
			}
			candidate.savedEdit = openedEdit;
			candidate.savedRevision = opened.project.revision;
			this.#assertOwner(owner, signal);
			if (peer.stopped) throw new Error(UTILITY_EXIT_MESSAGE);
			if (previous && this.#active === previous) {
				this.#active = null;
				await this.#closeProject(previous);
			}
			this.#assertOwner(owner, signal);
			if (peer.stopped) throw new Error(UTILITY_EXIT_MESSAGE);
			this.#active = candidate;
			this.#observeProjectExit(candidate);
			return opened;
		} catch (error) {
			if (candidate) await this.#closeProject(candidate);
			else await this.#removeEditScratch(scratch);
			throw error;
		}
	}

	async #import(active: ActiveProject, command: Extract<ActiveCommand, { kind: 'import' }>, signal: AbortSignal): Promise<Reply> {
		const selection = await this.#ports.chooseWave();
		this.#assertOwner(active.owner, signal);
		if (selection === null) return null;
		requireAbsoluteExtension(selection, '.wav');
		const asset = randomBytes(16).toString('hex');
		const staged = join(active.exchange, 'input', `${asset}.wav`);
		try {
			await stageTracktionWave(selection, staged, signal);
			this.#assertOwner(active.owner, signal);
			return await active.peer.request({
				kind: 'importFile', revision: command.revision, trackId: command.trackId, start: command.start,
				asset, name: mediaLabel(selection),
			});
		} finally {
			await rm(staged, { force: true });
		}
	}

	async #export(
		active: ActiveProject,
		command: Extract<ActiveCommand, { kind: 'render' | 'archive' }>,
		signal: AbortSignal,
	): Promise<Reply> {
		const format = command.kind === 'render' ? 'wav' : 'zip';
		const selection = await this.#ports.chooseExport(format);
		this.#assertOwner(active.owner, signal);
		if (selection === null) return null;
		requireAbsoluteExtension(selection, `.${format}`);
		const destination = join(await realpath(dirname(selection)), basename(selection));
		if (inside(join(active.directory, 'media'), destination) || inside(active.scratch, destination)) {
			throw new Error('Choose an export destination outside the project media and temporary data.');
		}
		const asset = randomBytes(16).toString('hex');
		const staged = join(active.exchange, 'output', `${asset}.${format}`);
		try {
			const result = await active.peer.request({ ...withoutSession(command), asset });
			this.#assertOwner(active.owner, signal);
			await this.#exports.publish(staged, destination, active.owner, signal);
			return result;
		} finally {
			await rm(staged, { force: true });
		}
	}
}

async function saveNewProject(active: ActiveProject): Promise<void> {
	// A successful native description means this Create started with an empty directory.
	const media = join(active.directory, 'media');
	const created = await lstat(media, { bigint: true });
	try {
		await active.peer.request({ kind: 'save', revision: 0 });
	} catch (error) {
		if (error instanceof TracktionRejectedCommand && created.isDirectory()) {
			const current = await lstat(media, { bigint: true }).catch(() => null);
			if (current?.isDirectory() && current.dev === created.dev && current.ino === created.ino) {
				await rmdir(media).catch(() => undefined);
			}
		}
		throw error;
	}
}

async function describe(active: ActiveProject): Promise<TracktionOpenedProject> {
	return {
		sessionId: active.id,
		name: basename(active.directory),
		project: await active.peer.request({ kind: 'project', offset: 0 }),
	};
}

async function readEditVersion(directory: string): Promise<string | null> {
	const metadata = await lstat(join(directory, EDIT_FILE), { bigint: true }).catch((error: unknown) => {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw error;
	});
	if (metadata === null) return null;
	if (!metadata.isFile()) throw new Error('The Tracktion project file is unavailable.');
	// Permission changes must allow Save to retry against the same file.
	return [metadata.dev, metadata.ino, metadata.size, metadata.mtimeNs].join(':');
}

async function selectedProjectDirectory(selection: string, kind: 'create' | 'open'): Promise<string> {
	if (!isAbsolute(selection)) throw new TypeError('A Tracktion project selection must be absolute.');
	const metadata = await lstat(selection);
	if (kind === 'open' && (!metadata.isFile() || basename(selection) !== EDIT_FILE)) {
		throw new TypeError(`Select the ${EDIT_FILE} file of a Tracktion project.`);
	}
	if (kind === 'create' && !metadata.isDirectory()) throw new TypeError('Select an empty project directory.');
	return await realpath(kind === 'create' ? selection : dirname(selection));
}

type WithoutSession<Command> = Command extends ActiveCommand ? Omit<Command, 'sessionId'> : never;

function withoutSession<Command extends ActiveCommand>(command: Command): WithoutSession<Command> {
	const { sessionId: _sessionId, ...rest } = command;
	return rest as WithoutSession<Command>;
}

function requireAbsoluteExtension(path: string, extension: string): void {
	if (!isAbsolute(path) || extname(path).toLowerCase() !== extension) {
		throw new TypeError(`Select a ${extension} file.`);
	}
}

function mediaLabel(path: string): string {
	const name = basename(path, extname(path)).trim() || 'Audio';
	// UTF-8 takes at most four bytes per Unicode code point.
	return Array.from(name).slice(0, 128).join('');
}

function inside(directory: string, path: string): boolean {
	const fromDirectory = relative(resolve(directory), path);
	return fromDirectory === '' || (fromDirectory !== '..' && !fromDirectory.startsWith(`..${sep}`) && !isAbsolute(fromDirectory));
}
