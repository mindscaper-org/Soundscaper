/* SPDX-License-Identifier: AGPL-3.0-only */

export interface TracktionTrackView {
	readonly id: string;
	readonly name: string;
	readonly clipCount: number;
}

export interface TracktionClipView {
	readonly id: string;
	readonly name: string;
	readonly start: number;
	readonly end: number;
	readonly sourceOffset: number;
}

export interface TracktionProjectPage {
	readonly revision: number;
	readonly sampleRate: number;
	readonly canUndo: boolean;
	readonly canRedo: boolean;
	readonly nextOffset: number | null;
	readonly tracks: readonly TracktionTrackView[];
}

export interface TracktionClipPage {
	readonly revision: number;
	readonly nextOffset: number | null;
	readonly clips: readonly TracktionClipView[];
}

export interface TracktionEditResult {
	readonly revision: number;
	readonly itemId: string | null;
}

export interface TracktionOpenedProject {
	readonly sessionId: string;
	readonly name: string;
	readonly project: TracktionProjectPage;
}

export interface TracktionTransportView {
	readonly ready: boolean;
	readonly playing: boolean;
	readonly frame: number;
}

export type TracktionTransportCommand =
	| Readonly<{ kind: 'transportStatus' | 'prepareOutput' | 'stop' }>
	| Readonly<{ kind: 'play' | 'seek'; frame: number }>
	| Readonly<{ kind: 'setLoop'; enabled: boolean; start: number; end: number }>;

type Session = Readonly<{ sessionId: string }>;
type Edit = Session & Readonly<{ revision: number }>;

export type TracktionProjectCommand =
	| Readonly<{ kind: 'create'; sampleRate: number }>
	| Readonly<{ kind: 'open' }>
	| (Session & Readonly<{ kind: 'project'; offset: number }>)
	| (Edit & Readonly<{ kind: 'clips'; trackId: string; offset: number }>)
	| (Edit & Readonly<{ kind: 'addTrack'; name: string }>)
	| (Edit & Readonly<{ kind: 'import'; trackId: string; start: number }>)
	| (Edit & Readonly<{ kind: 'trim'; clipId: string; start: number; end: number }>)
	| (Edit & Readonly<{ kind: 'split'; clipId: string; frame: number }>)
	| (Edit & Readonly<{ kind: 'undo' | 'redo' | 'save' }>)
	| (Edit & Readonly<{ kind: 'render'; start: number; end: number }>)
	| (Edit & Readonly<{ kind: 'archive' }>)
	| (Session & TracktionTransportCommand)
	| (Session & Readonly<{ kind: 'close' }>);

export type TracktionProjectReply<Command extends TracktionProjectCommand> =
	Command extends { kind: 'create' | 'open' } ? TracktionOpenedProject | null
		: Command extends { kind: 'project' } ? TracktionProjectPage
			: Command extends { kind: 'clips' } ? TracktionClipPage
				: Command extends { kind: 'import' | 'render' | 'archive' } ? TracktionEditResult | null
					: Command extends TracktionTransportCommand ? TracktionTransportView
						: Command extends { kind: 'close' } ? null : TracktionEditResult;

export interface TracktionDesktopBridge {
	request<Command extends TracktionProjectCommand>(command: Command): Promise<TracktionProjectReply<Command>>;
}
