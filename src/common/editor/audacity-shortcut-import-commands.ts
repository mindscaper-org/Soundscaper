/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDACITY_ACTION_ALIASES } from './audacity-action-aliases.js';
import { AUDACITY_SHORTCUT_BINDINGS_BY_ACTION } from './audacity-shortcut-bindings.ts';

/*
 * Audacity 3 CommandManager names are case-sensitive, stable script IDs, not
 * translated labels. Most have the same kebab-case spelling as Audacity 4;
 * these are the reviewed exceptions. Unknown names remain unsupported.
 * https://github.com/audacity/audacity/tree/Audacity-3.7.7/src/menus
 */
const LEGACY_COMMANDS: Readonly<Record<string, string>> = Object.freeze({
	New: 'file-new', Open: 'file-open', Save: 'file-save', SaveAs: 'file-save-as',
	SaveCopy: 'file-save-copy', Close: 'file-close', Export: 'export-audio',
	ImportAudio: 'project-import', ExportLabels: 'export-labels', ImportLabels: 'import-labels',
	ImportRaw: 'import-raw', Exit: 'quit',
	DeleteKey: 'action://delete', DeleteKey2: 'action://delete',
	SplitCut: 'cut-leave-gap', SplitDelete: 'delete-leave-gap',
	Cut: 'action://cut', Copy: 'action://copy', Paste: 'action://paste',
	Silence: 'silence-audio-selection',
	SelAllTracks: 'select-all-tracks', SelAll: 'select-all',
	SelTrackStartToCursor: 'select-track-start-to-cursor',
	SelCursorToTrackEnd: 'select-cursor-to-track-end',
	SelTrackStartToEnd: 'select-track-start-to-end',
	SelCursorStoredCursor: 'select-cursor-to-stored-cursor',
	SelStore: 'store-selection', SelRestore: 'retrieve-selection',
	SelPrevClipBoundaryToCursor: 'select-prev-clip-boundary-to-cursor',
	SelCursorToNextClipBoundary: 'select-cursor-to-next-clip-boundary',
	CursPrevClipBoundary: 'cursor-to-prev-clip-boundary',
	CursNextClipBoundary: 'cursor-to-next-clip-boundary',
	CursSelStart: 'cursor-to-selection-start', CursSelEnd: 'cursor-to-selection-end',
	CursTrackStart: 'cursor-to-track-start', CursTrackEnd: 'cursor-to-track-end',
	CursProjectStart: 'action://playback/rewind-start',
	CursProjectEnd: 'action://playback/rewind-end',
	CursorLeft: 'play-position-decrease', CursorRight: 'play-position-increase',
	TrackFocusUp: 'track-view-above-item', TrackFocusDown: 'track-view-below-item',
	TrackFocusFirst: 'track-view-first-track', TrackFocusLast: 'track-view-last-track',
	TrackFocusUpSelection: 'track-view-extend-track-selection-prev',
	TrackFocusDownSelection: 'track-view-extend-track-selection-next',
	TrackFocusToggle: 'track-view-toggle-selection',
	PrevFrame: 'track-view-prev-panel', NextFrame: 'track-view-next-panel',
	Play: 'action://playback/play', 'Play/Stop': 'action://playback/toggle-play-stop',
	Stop: 'action://playback/stop', Pause: 'action://playback/pause',
	DefaultPlayStop: 'action://playback/toggle-play-stop',
	PlayLooped: 'action://playback/toggle-play-from-cursor',
	Record1stChoice: 'record-on-current-track', Record2ndChoice: 'record-on-new-track',
	RecordNewTrack: 'record-on-new-track', Record: 'record-on-current-track',
	AppendRecord: 'record-on-current-track',
	MixAndRender: 'mix-render', MixAndRenderToNewTrack: 'mix-render',
	AddLabel: 'label-add', AddLabelPlaying: 'label-add',
	FitInWindow: 'zoom-to-fit-project', FitVertically: 'fit-height',
	ZoomSel: 'zoom-to-selection', ZoomSelection: 'zoom-to-selection',
	FullScreenOnOff: 'fullscreen',
	History: 'toggle-history', ShowClipping: 'toggle-clipping',
	EditMetaData: 'edit-meta-data', EditMetadata: 'edit-meta-data',
	MacroManager: 'manage-macros', ApplyMacro: 'apply-macros-palette',
});

const CONTEXTUAL_COMMANDS: Readonly<Record<string, string>> = Object.freeze({
	'nav-next-section': 'track-view-next-panel', 'nav-next-panel': 'track-view-next-panel',
	'nav-prev-section': 'track-view-prev-panel', 'nav-prev-panel': 'track-view-prev-panel',
	'curs-project-start': 'action://playback/rewind-start',
	'curs-project-end': 'action://playback/rewind-end',
	'seek-left-short': 'play-position-decrease', 'seek-right-short': 'play-position-increase',
	'seek-left-long': 'track-view-item-extend-left', 'seek-right-long': 'track-view-item-extend-right',
	'sel-ext-left': 'track-view-item-extend-left', 'sel-ext-right': 'track-view-item-extend-right',
	'sel-cntr-right': 'track-view-item-reduce-left', 'sel-cntr-left': 'track-view-item-reduce-right',
	'track-close': 'remove-tracks', 'mix-and-render-to-new-track': 'mix-render',
	'action://record/stop': 'action://playback/toggle-play-stop',
	'pitch-up': 'realtime-effect-move-up', 'pitch-down': 'realtime-effect-move-down',
});

const KNOWN_COMMANDS = new Set([
	...Object.keys(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION),
	...Object.values(AUDACITY_ACTION_ALIASES), ...Object.values(LEGACY_COMMANDS),
	...Object.values(CONTEXTUAL_COMMANDS),
]);

/** Resolve only stable source IDs; never guess from translated menu labels. */
export function audacityShortcutImportCommand(
	command: string, legacy: boolean, availableActionIds?: ReadonlySet<string>,
): string | null {
	const sourceId = legacy
		? LEGACY_COMMANDS[command] ?? command.replace(/([a-z\d])([A-Z])/gu, '$1-$2').toLowerCase()
		: command;
	const actionId = CONTEXTUAL_COMMANDS[sourceId]
		?? (AUDACITY_ACTION_ALIASES as Readonly<Record<string, string>>)[sourceId] ?? sourceId;
	return (availableActionIds ?? KNOWN_COMMANDS).has(actionId) ? actionId : null;
}
