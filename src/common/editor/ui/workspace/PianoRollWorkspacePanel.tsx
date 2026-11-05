/* SPDX-License-Identifier: AGPL-3.0-only */

import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { NoteGrid } from '@soundscaper/design-system/PianoRoll/NoteGrid';
import { PianoKeyboard } from '@soundscaper/design-system/PianoRoll/PianoKeyboard';
import { PianoRollRuler } from '@soundscaper/design-system/PianoRoll/PianoRollRuler';
import { PianoRollClipStrip } from '@soundscaper/design-system/PianoRoll/PianoRollClipStrip';
import { readMidiClip, readMidiTrack, type MidiInstrument, type MidiNote } from '../../midi-model.ts';
import { createStableId } from '../../stable-id.js';
import type { EditorAudioClip, EditorAudioTrack, EditorProject } from '../../types.ts';
import { resolveMidiCopy } from '../../../i18n/editor-midi-copy.ts';
import { useElementSize } from '../use-element-size.ts';
import { createMidiPanelPlayheadProjector, designSystemMidiClip, midiBeatsPerMeasure, midiNoteChanges, midiPanelClipResize, midiPanelSelection } from './midi-panel-projection.ts';
import { MidiNoteNumberField } from './MidiNoteNumberField.tsx';
import './PianoRollWorkspacePanel.css';

interface MidiActions {
	addNote(clipId: string, note: MidiNote): unknown;
	updateNote(clipId: string, noteId: string, changes: Partial<MidiNote>): unknown;
	updateNotes(clipId: string, updates: readonly { id: string; changes: Partial<MidiNote> }[]): unknown;
	deleteNotes(clipId: string, ids: readonly string[]): unknown;
	resizeClip(clipId: string, changes: ClipChanges): unknown;
	setInstrument(trackId: string, instrument: MidiInstrument): unknown;
	previewNote(pitch: number, instrument?: MidiInstrument): unknown;
}

interface ClipChanges {
	readonly timelineStartFrame: number;
	readonly sourceStartFrame: number;
	readonly durationFrames: number;
}

interface PianoRollController {
	readonly actions: { readonly midi: MidiActions };
	subscribeTelemetry(listener: () => void): () => void;
	getTelemetrySnapshot(): { readonly positionFrame: number };
}

interface PianoRollWorkspacePanelProps {
	readonly controller: PianoRollController;
	readonly snapshot: {
		readonly project: EditorProject | null;
		readonly selectedTrackId: string | null;
		readonly selectedClipId: string | null;
		readonly readOnly?: boolean;
	};
	readonly copy: Readonly<Record<string, string>>;
	readonly blocked: boolean;
	readonly run: (operation: () => unknown) => unknown;
}

const KEY_PITCHES: Readonly<Record<string, number>> = {
	a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12,
};
const INSTRUMENTS: readonly MidiInstrument[] = ['sine', 'triangle', 'square', 'sawtooth'];
const SUBDIVISIONS = [1, 2, 4, 8, 16, 32] as const;
type Subdivision = typeof SUBDIVISIONS[number];

export default function PianoRollWorkspacePanel(props: PianoRollWorkspacePanelProps) {
	const selection = midiPanelSelection(props.snapshot.project, props.snapshot.selectedTrackId, props.snapshot.selectedClipId);
	if (!selection || !props.snapshot.project) return <p className="kw-audio-editor__panel-empty">{resolveMidiCopy(props.copy).empty}</p>;
	return <PianoRollEditor key={`${props.snapshot.project.id}:${selection.clip.id}`} {...props}
		project={props.snapshot.project} track={selection.track} clip={selection.clip} />;
}

function PianoRollEditor({ controller, snapshot, copy: inputCopy, blocked, run, project, track, clip }: PianoRollWorkspacePanelProps & {
	readonly project: EditorProject; readonly track: EditorAudioTrack; readonly clip: EditorAudioClip;
}) {
	const copy = resolveMidiCopy(inputCopy);
	const sampleRate = project.sources?.find(source => source.id === clip.sourceId)?.sampleRate ?? project.sampleRate;
	const persistedNotes = useMemo(() => readMidiClip(clip)?.notes ?? [], [clip]);
	const instrument = readMidiTrack(track)?.instrument ?? 'sine';
	const disabled = blocked || snapshot.readOnly === true || track.locked === true;
	const [panelRef, panelSize] = useElementSize();
	const [controlsRef, controlsSize] = useElementSize();
	const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
	const [drafts, setDrafts] = useState<ReadonlyMap<string, Partial<MidiNote>>>(() => new Map());
	const [clipDraft, setClipDraft] = useState<(ClipChanges & { readonly sourceDurationFrames: number }) | null>(null);
	const [scrollX, setScrollX] = useState(clip.sourceStartFrame / sampleRate * 100);
	const [scrollY, setScrollY] = useState((128 - 60 - 4) * 16);
	const [pixelsPerSecond, setPixelsPerSecond] = useState(100);
	const [subdivision, setSubdivision] = useState<Subdivision>(4);
	const [triplet, setTriplet] = useState(false);
	const [keyboardEnabled, setKeyboardEnabled] = useState(false);
	const [octave, setOctave] = useState(3);
	const [hoveredPitch, setHoveredPitch] = useState<number | null>(null);
	const gesture = useRef(false);
	const pendingNotes = useRef(new Map<string, Partial<MidiNote>>());
	const pendingClip = useRef<ClipChanges | null>(null);
	const mounted = useRef(true);
	const tempo = project.tempo as { readonly bpm?: number; readonly timeSignature?: { readonly numerator?: number; readonly denominator?: number } } | undefined;
	const bpm = tempo?.bpm ?? 120;
	const beatsPerMeasure = midiBeatsPerMeasure(tempo?.timeSignature);
	const notes = useMemo(() => drafts.size ? persistedNotes.map(note => {
		const changes = drafts.get(note.id);
		return changes ? { ...note, ...changes } : note;
	}) : persistedNotes, [persistedNotes, drafts]);
	const effectiveClip = useMemo(() => clipDraft ? { ...clip, ...clipDraft } : clip, [clip, clipDraft]);
	const designClip = useMemo(() => designSystemMidiClip(effectiveClip, project.sampleRate, selectedIds, notes, sampleRate), [effectiveClip, project.sampleRate, sampleRate, selectedIds, notes]);
	const snap = useMemo(() => ({ subdivision, triplet }), [subdivision, triplet]);
	const gridWidth = Math.max(0, panelSize.width - 104);
	const gridHeight = Math.max(100, panelSize.height - controlsSize.height - 52);
	const selectedNotes = useMemo(() => notes.filter(note => selectedIds.has(note.id)), [notes, selectedIds]);
	const noteOptions = useMemo(() => notes.map(note => <MidiNoteOption key={note.id} note={note} format={copy.noteOption} sampleRate={sampleRate} />), [copy.noteOption, notes, sampleRate]);
	const activeNote = selectedNotes[0];

	useEffect(() => {
		mounted.current = true;
		return () => { mounted.current = false; };
	}, []);

	useEffect(() => {
		const finish = (event: Event) => {
			if ('button' in event && event.button !== 0) return;
			if (!gesture.current) return;
			gesture.current = false;
			const updates = [...pendingNotes.current].map(([id, changes]) => ({ id, changes }));
			const resizedClip = pendingClip.current;
			pendingNotes.current = new Map();
			pendingClip.current = null;
			if (disabled) { setDrafts(new Map()); setClipDraft(null); return; }
			if (!updates.length && !resizedClip) return;
			run(async () => {
				try {
					if (updates.length) await controller.actions.midi.updateNotes(clip.id, updates);
					if (resizedClip) await controller.actions.midi.resizeClip(clip.id, resizedClip);
				} finally {
					if (mounted.current) { setDrafts(new Map()); setClipDraft(null); }
				}
			});
		};
		document.addEventListener('mouseup', finish);
		window.addEventListener('blur', finish);
		return () => { document.removeEventListener('mouseup', finish); window.removeEventListener('blur', finish); };
	}, [clip.id, controller, disabled, run]);

	const edit = (operation: () => unknown) => { if (!disabled) run(operation); };
	const preview = (pitch: number) => { run(() => controller.actions.midi.previewNote(pitch, instrument)); };
	const select = (numericIds: readonly number[], additive = false) => {
		setSelectedIds(previous => new Set([
			...(additive ? previous : []),
			...numericIds.flatMap(id => notes[id - 1]?.id ? [notes[id - 1]!.id] : []),
		]));
	};
	const selectNote = (numericId: number, additive = false) => {
		const note = notes[numericId - 1];
		if (!note) return;
		if (!additive) { select([numericId]); return; }
		setSelectedIds(previous => {
			const selected = new Set(previous);
			if (selected.has(note.id)) selected.delete(note.id); else selected.add(note.id);
			return selected;
		});
	};
	const update = (numericId: number, changes: Partial<MidiNote>) => {
		const note = notes[numericId - 1];
		if (!note || disabled) return;
		if (!gesture.current) { edit(() => controller.actions.midi.updateNote(clip.id, note.id, changes)); return; }
		pendingNotes.current.set(note.id, { ...pendingNotes.current.get(note.id), ...changes });
		setDrafts(new Map(pendingNotes.current));
	};
	const editSelected = (changes: Partial<MidiNote>) => {
		edit(() => controller.actions.midi.updateNotes(clip.id, selectedNotes.map(note => ({ id: note.id, changes }))));
	};
	const resize = (edge: 'left' | 'right', start: number, duration: number, trimStart: number) => {
		if (disabled) return;
		const { changes, sourceDurationFrames } = midiPanelClipResize(project, clip, sampleRate, edge, start, duration, trimStart);
		pendingClip.current = changes; setClipDraft({ ...changes, sourceDurationFrames });
	};
	const deleteSelected = () => edit(() => controller.actions.midi.deleteNotes(clip.id, [...selectedIds]));
	const addNote = () => {
		const note: MidiNote = {
			id: createStableId('midi-note'), pitch: 60, velocity: 100, channel: 0,
			startFrame: Math.max(clip.sourceStartFrame, Math.round(scrollX / pixelsPerSecond * sampleRate)),
			durationFrames: Math.max(1, Math.round(60 / bpm / subdivision / (triplet ? 1.5 : 1) * sampleRate)),
		};
		edit(() => controller.actions.midi.addNote(clip.id, note));
		setSelectedIds(new Set([note.id]));
	};
	const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.target instanceof HTMLElement && event.target.closest('input:not([type="checkbox"]),select,textarea,button')) return;
		if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
		const key = event.key.toLowerCase();
		if (keyboardEnabled && (key === 'z' || key === 'x')) {
			event.preventDefault(); event.stopPropagation();
			setOctave(previous => Math.max(-1, Math.min(8, previous + (key === 'x' ? 1 : -1))));
		} else if (keyboardEnabled && KEY_PITCHES[key] !== undefined) {
			event.preventDefault(); event.stopPropagation(); preview(Math.min(127, (octave + 1) * 12 + KEY_PITCHES[key]!));
		}
	};

	return <div ref={panelRef} className="kw-audio-editor__piano-roll" aria-label={copy.pianoRoll} onKeyDown={keyDown}>
		<div ref={controlsRef} className="kw-audio-editor__piano-roll-controls">
			<label>{copy.instrument}<select value={instrument} disabled={disabled}
				onChange={event => { const value = event.currentTarget.value as MidiInstrument; edit(() => controller.actions.midi.setInstrument(track.id, value)); }}>
				{INSTRUMENTS.map(value => <option key={value} value={value}>{copy[value]}</option>)}
			</select></label>
			<label>{copy.snap}<select value={subdivision} onChange={event => setSubdivision(Number(event.currentTarget.value) as Subdivision)}>
				{SUBDIVISIONS.map(value => <option key={value} value={value}>1/{value * 4}</option>)}
			</select></label>
			<label><input type="checkbox" checked={triplet} onChange={event => setTriplet(event.currentTarget.checked)} />{copy.triplets}</label>
			<label><input type="checkbox" checked={keyboardEnabled} onChange={event => setKeyboardEnabled(event.currentTarget.checked)} />{copy.keyboard}</label>
			{keyboardEnabled && <label>{copy.octave}<MidiNoteNumberField min={-1} max={8} step={1} value={octave}
				onCommit={setOctave} disabled={false} title={copy.keyboardHint} /></label>}
			<button type="button" disabled={disabled} onClick={addNote}>{copy.addNote}</button>
			<button type="button" disabled={disabled || !selectedNotes.length} onClick={deleteSelected}>{copy.deleteNotes}</button>
			<div className="kw-audio-editor__piano-roll-note-editor" role="group" aria-label={copy.noteEditor}>
				<label>{copy.selectedNote}<select value={activeNote?.id ?? ''} onChange={event => setSelectedIds(new Set(event.currentTarget.value ? [event.currentTarget.value] : []))}>
					<option value="">{copy.noSelection}</option>
					{noteOptions}
				</select></label>
				<label>{copy.pitch}<MidiNoteNumberField key={`pitch:${activeNote?.id}`} min={0} max={127} step={1} disabled={disabled || !activeNote} value={activeNote?.pitch ?? ''}
					onCommit={value => editSelected({ pitch: value })} /></label>
				<label>{copy.start}<MidiNoteNumberField key={`start:${activeNote?.id}`} min={0} step={0.001} disabled={disabled || !activeNote} value={activeNote ? activeNote.startFrame / sampleRate : ''}
					onCommit={value => editSelected({ startFrame: Math.round(value * sampleRate) })} /></label>
				<label>{copy.duration}<MidiNoteNumberField key={`duration:${activeNote?.id}`} min={1 / sampleRate} step={0.001} disabled={disabled || !activeNote} value={activeNote ? activeNote.durationFrames / sampleRate : ''}
					onCommit={value => editSelected({ durationFrames: Math.max(1, Math.round(value * sampleRate)) })} /></label>
				<label>{copy.velocity}<MidiNoteNumberField key={`velocity:${activeNote?.id}`} min={1} max={127} step={1} disabled={disabled || !activeNote} value={activeNote?.velocity ?? ''}
					onCommit={value => editSelected({ velocity: value })} /></label>
				<label>{copy.channel}<MidiNoteNumberField key={`channel:${activeNote?.id}`} min={1} max={16} step={1} disabled={disabled || !activeNote} value={activeNote ? activeNote.channel + 1 : ''}
					onCommit={value => editSelected({ channel: value - 1 })} /></label>
				<button type="button" disabled={!activeNote} onClick={() => { if (activeNote) preview(activeNote.pitch); }}>{copy.preview}</button>
			</div>
		</div>
		<div className="kw-audio-editor__piano-roll-grid" role="group" aria-label={copy.grid}>
			<PianoKeyboard scrollY={scrollY} noteHeight={16} height={gridHeight + 52} onKeyClick={preview} onHoverKey={setHoveredPitch} clipStripVisible />
			<div className="kw-audio-editor__piano-roll-notes" onMouseDownCapture={() => { if (!disabled) gesture.current = true; }}>
				<PianoRollRuler width={gridWidth} scrollX={scrollX} pixelsPerSecond={pixelsPerSecond} bpm={bpm} beatsPerMeasure={beatsPerMeasure} snap={snap} timeBasis="beats" />
				<PianoRollClipStrip clips={[designClip]} activeClipId={1} width={gridWidth} scrollX={scrollX} pixelsPerSecond={pixelsPerSecond}
					bpm={bpm} snap={snap} onResizeClip={resize} />
				<NoteGrid clip={designClip} bpm={bpm} beatsPerMeasure={beatsPerMeasure} width={gridWidth} height={gridHeight}
					pixelsPerSecond={pixelsPerSecond} scrollX={scrollX} scrollY={scrollY} noteHeight={16} snap={snap} timeBasis="beats"
					onAddNote={note => {
						const id = createStableId('midi-note');
						edit(() => controller.actions.midi.addNote(clip.id, { id, pitch: note.pitch, velocity: note.velocity, channel: 0,
							startFrame: Math.max(0, Math.round(note.startTime * sampleRate)), durationFrames: Math.max(1, Math.round(note.duration * sampleRate)) }));
						setSelectedIds(new Set([id]));
					}}
					onDeleteNotes={ids => edit(() => controller.actions.midi.deleteNotes(clip.id, ids.flatMap(id => notes[id - 1]?.id ? [notes[id - 1]!.id] : [])))}
					onUpdateNote={(id, changes) => update(id, midiNoteChanges(changes, sampleRate))}
					onResizeNote={(id, duration) => update(id, { durationFrames: Math.max(1, Math.round(duration * sampleRate)) })}
					onMoveNotes={(ids, pitch, time) => ids.forEach(id => { const note = notes[id - 1]; if (note) update(id, { pitch: Math.max(0, Math.min(127, note.pitch + pitch)), startFrame: Math.max(0, note.startFrame + Math.round(time * sampleRate)) }); })}
					onSelectNote={selectNote} onSelectNotes={select} onDeselectAll={() => setSelectedIds(new Set())}
					onScrollYChange={setScrollY} onPixelsPerSecondChange={setPixelsPerSecond} onScrollXChange={setScrollX}
					onResizeClip={resize}
					hoveredKeyPitch={hoveredPitch} onPlayNote={preview} />
				<PianoRollPlayhead controller={controller} project={project} clip={clip} sampleRate={sampleRate} pixelsPerSecond={pixelsPerSecond} scrollX={scrollX} width={gridWidth} />
			</div>
		</div>
	</div>;
}

const MidiNoteOption = memo(function MidiNoteOption({ note, format, sampleRate }: {
	readonly note: MidiNote; readonly format: string; readonly sampleRate: number;
}) {
	return <option value={note.id}>{format.replace('{pitch}', String(note.pitch)).replace('{time}', (note.startFrame / sampleRate).toFixed(3))}</option>;
});

/** Transport ticks move only the cursor; the note editor keeps its render cadence. */
function PianoRollPlayhead({ controller, project, clip, sampleRate, pixelsPerSecond, scrollX, width }: {
	readonly controller: PianoRollController; readonly project: EditorProject; readonly clip: EditorAudioClip;
	readonly sampleRate: number; readonly pixelsPerSecond: number; readonly scrollX: number; readonly width: number;
}) {
	const telemetry = useSyncExternalStore(controller.subscribeTelemetry, controller.getTelemetrySnapshot, controller.getTelemetrySnapshot);
	const sourcePosition = useMemo(() => createMidiPanelPlayheadProjector(project, clip), [project, clip]);
	const frame = sourcePosition(telemetry.positionFrame);
	const x = frame === null ? -1 : frame / sampleRate * pixelsPerSecond - scrollX;
	return x >= 0 && x <= width ? <div className="kw-audio-editor__piano-roll-playhead" style={{ left: x }} /> : null;
}
