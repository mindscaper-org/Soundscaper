/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';

import { AUDIO_DEVICE_COPY_BY_LOCALE } from '../../common/i18n/audio-device-copy.js';
import { EDIT_COMMAND_COPY_BY_LOCALE } from '../../common/i18n/edit-command-copy.js';
import { RECORDING_RECOVERY_COPY } from '../../common/i18n/editor-recording-recovery-copy.ts';
import { PROJECT_COMMAND_COPY_BY_LOCALE } from '../../common/i18n/project-command-copy.js';
import { TRACK_COPY_BY_LOCALE } from '../../common/i18n/track-copy.js';
import { TRANSPORT_COPY_BY_LOCALE } from '../../common/i18n/transport-copy.js';
import type { TracktionAudioHosts } from '../tracktion-audio-device-contract.ts';
import {
	TRACKTION_AUTOMATION_PAGE_SIZE, type TracktionAutomationEdit, type TracktionAutomationPage, type TracktionAutomationParameter,
} from '../tracktion-automation-contract.ts';
import type { TracktionEffectInstallation, TracktionEffectPage, TracktionEffectSlot } from '../tracktion-effect-contract.ts';
import type {
	TracktionClipCommand, TracktionPasteCommand, TracktionProjectBridge, TracktionRangeCommand, TracktionTrackMix, TracktionTransportObservation,
} from '../tracktion-project-contract.ts';
import { startTracktionPlayback } from '../tracktion-transport.ts';
import {
	readOpenedTracktionWorkspace, readTracktionWorkspace, readTracktionWorkspaceAfterClipEdit,
	readTracktionWorkspaceAfterSelection, readTracktionWorkspaceAfterTrackInsertion, readTracktionWorkspaceWithCachedTracks,
	type TracktionWorkspace,
} from '../tracktion-workspace.ts';
import { TracktionAudioSetupDialog } from './TracktionAudioSetupDialog.tsx';
import { TracktionAutomationDialog } from './TracktionAutomationDialog.tsx';
import { TracktionClipEditDialog } from './TracktionClipEditDialog.tsx';
import { TracktionEffectsDialog, tracktionEffectsTitle } from './TracktionEffectsDialog.tsx';
import { TracktionMixerDialog } from './TracktionMixerDialog.tsx';
import { TracktionPasteDialog } from './TracktionPasteDialog.tsx';
import { TracktionRangeEditDialog } from './TracktionRangeEditDialog.tsx';

const copy = PROJECT_COMMAND_COPY_BY_LOCALE.en;
const editCopy = EDIT_COMMAND_COPY_BY_LOCALE.en;
const trackCopy = TRACK_COPY_BY_LOCALE.en;
const transportCopy = TRANSPORT_COPY_BY_LOCALE.en;

export function TracktionEditor({ bridge, recordingInput = true, desktopAudioSetup = false, desktopEffects = false }: {
	readonly bridge: TracktionProjectBridge;
	readonly recordingInput?: boolean;
	readonly desktopAudioSetup?: boolean;
	readonly desktopEffects?: boolean;
}) {
	const [workspace, setWorkspace] = useState<TracktionWorkspace | null>(null);
	const [savedRevision, setSavedRevision] = useState<number | null>(null);
	const [transport, setTransport] = useState<TracktionTransportObservation | null>(null);
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState('');
	const [failure, setFailure] = useState('');
	const [clipEdit, setClipEdit] = useState<TracktionClipCommand['kind'] | null>(null);
	const [rangeEdit, setRangeEdit] = useState<TracktionRangeCommand['kind'] | null>(null);
	const [pasteFrame, setPasteFrame] = useState<number | null>(null);
	const [hasClipboard, setHasClipboard] = useState(false);
	const [mixer, setMixer] = useState<TracktionTrackMix | null>(null);
	const [automation, setAutomation] = useState<{
		parameter: TracktionAutomationParameter; offset: number; page: TracktionAutomationPage; selectedFrame: number | null;
	} | null>(null);
	const [audioSetup, setAudioSetup] = useState<TracktionAudioHosts | null>(null);
	const [effects, setEffects] = useState<{ slots: TracktionEffectSlot[]; catalog: readonly TracktionEffectInstallation[] | null } | null>(null);
	const pending = useRef(false);
	const transportProbe = useRef<Promise<void> | null>(null);
	const dirty = workspace !== null && workspace.project.revision !== savedRevision;
	const recording = transport?.recording === true;
	const playing = transport?.playing === true;
	const visibleStatus = recording ? 'Recording' : status || (playing ? 'Playing' : '');
	const menuBar = useRef<HTMLElement>(null);
	const tracks = workspace?.tracks;
	const trackOptions = useMemo(() => tracks?.map((track) => <option key={track.id} value={track.id}>{track.name}</option>), [tracks]);
	const clips = workspace?.clips;
	const { clipRows, splittable } = useMemo(() => ({
		clipRows: clips?.map((clip) => <li key={clip.id}>{clip.name} ({clip.start}–{clip.end})</li>),
		splittable: clips?.filter((clip) => clip.end - clip.start > 1) ?? [],
	}), [clips]);

	useEffect(() => {
		if (!dirty && !recording) return;
		const onUnload = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener('beforeunload', onUnload);
		return () => window.removeEventListener('beforeunload', onUnload);
	}, [dirty, recording]);

	const recoverMicrophone = useEffectEvent(() => {
		finishRecording(false);
	});
	useEffect(() => bridge.onRecordingInterrupted?.(() => recoverMicrophone()), [bridge]);

	const dismissLostProject = useEffectEvent((sessionId: string, message: string) => {
		if (workspace?.sessionId !== sessionId) return;
		setWorkspace(null);
		setSavedRevision(null);
		setTransport(null);
		setHasClipboard(false);
		setClipEdit(null);
		setRangeEdit(null);
		setPasteFrame(null);
		setMixer(null);
		setAutomation(null);
		setAudioSetup(null);
		setEffects(null);
		setStatus('');
		setFailure(message);
	});
	useEffect(() => bridge.onProjectLost?.((sessionId, message) => dismissLostProject(sessionId, message)), [bridge]);

	const observeNativeTransport = useEffectEvent((isCurrent: () => boolean) => {
		if (!workspace || pending.current || transportProbe.current) return;
		const probe = bridge.request({ kind: 'transportObservation', sessionId: workspace.sessionId }).then(async (next) => {
			const take = next.interruptedTake;
			const lostOutput = next.outputInterrupted && (next.recording || !next.playing) && !transport?.outputInterrupted;
			const stopped = transport?.playing && !next.playing && !next.recording;
			if ((!take && !lostOutput && !stopped) || !isCurrent() || pending.current) return;
			const updated = take?.itemId ? await readTracktionWorkspaceAfterClipEdit(bridge, workspace, take) : workspace;
			if (!isCurrent() || pending.current) return;
			setWorkspace(updated);
			setTransport(next);
			if (take) setStatus(take.itemId ? 'Recording added to the track' : 'No audio was recorded');
			else if (!next.recording) setStatus('Stopped');
			if (lostOutput) setFailure(AUDIO_DEVICE_COPY_BY_LOCALE.en.audioHostDeviceLost);
		}).catch((error: unknown) => {
			if (isCurrent() && !pending.current) setFailure(error instanceof Error ? error.message : String(error));
		});
		transportProbe.current = probe;
		void probe.finally(() => { transportProbe.current = null; });
	});
	useEffect(() => {
		if (!desktopAudioSetup || (!recording && !playing)) return;
		let mounted = true;
		const interval = window.setInterval(() => observeNativeTransport(() => mounted), 250);
		return () => {
			mounted = false;
			window.clearInterval(interval);
		};
	}, [desktopAudioSetup, recording, playing]);

	function run(work: () => Promise<void>): void {
		if (pending.current) return;
		pending.current = true;
		setBusy(true);
		setFailure('');
		setStatus('');
		closeMenus();
		// A desktop command shares the request channel with the transport status read.
		const probe = transportProbe.current;
		const result = probe ? probe.then(work) : work();
		void result.catch((error: unknown) => {
			setFailure(error instanceof Error ? error.message : String(error));
		}).finally(() => {
			pending.current = false;
			setBusy(false);
		});
	}

	function closeMenus(): void {
		for (const menu of menuBar.current?.querySelectorAll<HTMLDetailsElement>('details[open]') ?? []) menu.open = false;
	}

	function confirmReplacement(): boolean {
		return !dirty || window.confirm('Close the current project and discard unsaved changes?');
	}

	function readTransport(sessionId: string): Promise<TracktionTransportObservation> {
		return desktopAudioSetup ? bridge.request({ kind: 'transportObservation', sessionId })
			: bridge.request({ kind: 'transportStatus', sessionId });
	}

	function open(kind: 'open' | 'create' | 'archive'): void {
		if (!confirmReplacement()) return;
		run(async () => {
			const opened = kind === 'archive' ? await bridge.openArchive?.()
				: await bridge.request(kind === 'create' ? { kind, sampleRate: 48_000 } : { kind });
			if (!opened) return;
			const next = await readOpenedTracktionWorkspace(bridge, opened);
			setTransport(opened.transport ?? await readTransport(opened.sessionId));
			setWorkspace(next);
			if (opened.sessionId !== workspace?.sessionId) setSavedRevision(opened.initiallyUnsaved ? null : next.project.revision);
		});
	}

	function close(): void {
		if (!workspace || !confirmReplacement()) return;
		run(async () => {
			await bridge.request({ kind: 'close', sessionId: workspace.sessionId });
			setWorkspace(null);
			setTransport(null);
			setSavedRevision(null);
		});
	}

	function save(): void {
		if (!workspace) return;
		run(async () => {
			const result = await bridge.request({ kind: 'save', sessionId: workspace.sessionId, revision: workspace.project.revision });
			setSavedRevision(result.revision);
			setStatus(copy.projectSaved);
		});
	}

	function selectTrack(trackId: string): void {
		if (!workspace || workspace.selectedTrack?.id === trackId) return;
		const selectedTrack = workspace.tracks.find((track) => track.id === trackId);
		if (!selectedTrack) return;
		run(async () => setWorkspace(await readTracktionWorkspaceAfterSelection(bridge, workspace, selectedTrack)));
	}

	function importWave(): void {
		if (!workspace?.selectedTrack) return;
		const trackId = workspace.selectedTrack.id;
		const start = workspace.clips.reduce((end, clip) => Math.max(end, clip.end), 0);
		run(async () => {
			const result = await bridge.request({
				kind: 'import', sessionId: workspace.sessionId, revision: workspace.project.revision, trackId, start,
			});
			if (result) setWorkspace(await readTracktionWorkspaceAfterClipEdit(bridge, workspace, result));
		});
	}

	function editProject(kind: 'addTrack' | 'duplicateTrack' | 'undo' | 'redo'): void {
		if (!workspace) return;
		const trackId = workspace.selectedTrack?.id;
		const command = { sessionId: workspace.sessionId, revision: workspace.project.revision };
		const edit = kind === 'duplicateTrack' ? trackId && { ...command, kind, trackId }
			: kind === 'addTrack' ? { ...command, kind, name: `${trackCopy.audioTrack} ${workspace.tracks.length + 1}` }
				: { ...command, kind };
		if (!edit) return;
		run(async () => {
			const result = await bridge.request(edit);
			if (edit.kind === 'addTrack' || edit.kind === 'duplicateTrack') {
				setWorkspace(await readTracktionWorkspaceAfterTrackInsertion(bridge, workspace, result));
				return;
			}
			setWorkspace(await readTracktionWorkspace(bridge, workspace, result.itemId ?? trackId));
			if (playing && (kind === 'undo' || kind === 'redo')) {
				const current = await readTransport(workspace.sessionId);
				if (!current.playing && !current.recording) {
					setTransport(await bridge.request({ kind: 'stop', sessionId: workspace.sessionId }));
					setStatus('Stopped');
					if (current.outputInterrupted) setFailure(AUDIO_DEVICE_COPY_BY_LOCALE.en.audioHostDeviceLost);
				}
			}
		});
	}

	function chooseClipEdit(kind: TracktionClipCommand['kind']): void {
		closeMenus();
		setFailure('');
		setClipEdit(kind);
	}

	function chooseRangeEdit(kind: TracktionRangeCommand['kind']): void {
		closeMenus();
		setFailure('');
		setRangeEdit(kind);
	}

	function showPaste(): void {
		if (!workspace || !transport) return;
		if (!playing) {
			closeMenus();
			setFailure('');
			setPasteFrame(transport.frame);
			return;
		}
		run(async () => {
			const current = await readTransport(workspace.sessionId);
			setPasteFrame(current.frame);
		});
	}

	function applyTimelineEdit(edit: TracktionClipCommand | TracktionRangeCommand | TracktionPasteCommand): void {
		if (!workspace) return;
		run(async () => {
			const result = await bridge.request({ ...edit, sessionId: workspace.sessionId, revision: workspace.project.revision });
			setClipEdit(null);
			setRangeEdit(null);
			setPasteFrame(null);
			if (edit.kind === 'copyRange' || edit.kind === 'cutRange') setHasClipboard(true);
			if (edit.kind === 'copyRange' || result.revision === workspace.project.revision) return;
			if ('clipId' in edit) {
				const target = 'trackId' in edit ? { trackId: edit.trackId } : undefined;
				const leavesSource = edit.kind === 'deleteClip' || (edit.kind === 'moveClip' && edit.trackId !== workspace.selectedTrack?.id);
				const changed = leavesSource ? { ...target, removedFromSource: edit.clipId } : target;
				setWorkspace(await readTracktionWorkspaceAfterClipEdit(bridge, workspace, result, changed));
				return;
			}
			if (edit.kind !== 'pasteRange' && edit.trackId !== null) {
				setWorkspace(await readTracktionWorkspaceAfterClipEdit(bridge, workspace, result, { trackId: edit.trackId }));
				return;
			}
			const selectedTrack = edit.trackId ?? workspace.selectedTrack?.id;
			setWorkspace(await readTracktionWorkspace(bridge, workspace, selectedTrack));
		});
	}

	function showMixer(): void {
		if (!workspace?.selectedTrack) return;
		const trackId = workspace.selectedTrack.id;
		run(async () => setMixer(await bridge.request({
			kind: 'trackMix', trackId, sessionId: workspace.sessionId, revision: workspace.project.revision,
		})));
	}

	function applyMixer(mix: TracktionTrackMix): void {
		setMixer(null);
		if (!workspace?.selectedTrack) return;
		const trackId = workspace.selectedTrack.id;
		run(async () => {
			const result = await bridge.request({ ...mix, kind: 'setTrackMix', trackId, sessionId: workspace.sessionId, revision: workspace.project.revision });
			setWorkspace(await readTracktionWorkspaceWithCachedTracks(bridge, workspace, result));
		});
	}

	function showAutomation(parameter: TracktionAutomationParameter = 'gainDb', offset = 0): void {
		if (!workspace?.selectedTrack) return;
		const { sessionId, project: { revision }, selectedTrack: { id: trackId } } = workspace;
		run(async () => {
			const page = await bridge.request({ kind: 'trackAutomation', sessionId, revision, trackId, parameter, offset });
			setAutomation({ parameter, offset, page, selectedFrame: null });
		});
	}

	function applyAutomation(edit: TracktionAutomationEdit): void {
		if (!workspace?.selectedTrack || !automation) return;
		const { sessionId, project: { revision }, selectedTrack: { id: trackId } } = workspace;
		run(async () => {
			const result = await bridge.request({ ...edit, sessionId, revision, trackId });
			const updated = await readTracktionWorkspaceWithCachedTracks(bridge, workspace, result);
			setWorkspace(updated);
			const { parameter } = edit;
			const selectedFrame = edit.kind === 'setAutomationPoint' && edit.index !== null ? edit.frame : null;
			const removesLastPoint = edit.kind === 'removeAutomationPoint' && automation.page.nextOffset === null && automation.page.points.length === 1;
			let currentOffset = automation.offset;
			if (selectedFrame !== null && 'pointIndex' in result) {
				currentOffset = Math.floor(result.pointIndex / TRACKTION_AUTOMATION_PAGE_SIZE) * TRACKTION_AUTOMATION_PAGE_SIZE;
			} else if (removesLastPoint) {
				currentOffset = Math.max(0, automation.offset - TRACKTION_AUTOMATION_PAGE_SIZE);
			}
			const offset = edit.kind === 'clearAutomation' || updated.project.revision !== result.revision ? 0 : currentOffset;
			const page = await bridge.request({ kind: 'trackAutomation', sessionId, revision: updated.project.revision, trackId, parameter, offset });
			setAutomation({ parameter, offset, page, selectedFrame });
		});
	}

	function exportProject(format: 'archive' | 'render'): void {
		if (!workspace) return;
		const { sessionId, project: { revision } } = workspace;
		run(async () => {
			await bridge.request(format === 'archive' ? { kind: 'archive', sessionId, revision } : { kind: 'render', sessionId, revision });
		});
	}

	function showAudioSetup(): void {
		if (!workspace) return;
		const { sessionId } = workspace;
		run(async () => setAudioSetup(await bridge.request({ kind: 'audioHosts', sessionId })));
	}

	function controlPlayback(kind: 'play' | 'stop' | 'seek'): void {
		if (!workspace) return;
		const { sessionId } = workspace;
		run(async () => {
			const next = kind === 'play' ? await startTracktionPlayback(bridge, sessionId)
				: await bridge.request(kind === 'seek' ? { kind, sessionId, frame: 0 } : { kind, sessionId });
			setTransport(next);
			if (!next.playing) setStatus('Stopped');
		});
	}

	function startRecording(): void {
		if (!workspace?.selectedTrack) return;
		const trackId = workspace.selectedTrack.id;
		run(async () => {
			const next = await bridge.request({
				kind: 'startRecording', sessionId: workspace.sessionId, revision: workspace.project.revision,
				trackId, frame: transport?.frame ?? 0,
			});
			setTransport(next);
			if (next.outputInterrupted) setFailure(AUDIO_DEVICE_COPY_BY_LOCALE.en.audioHostDeviceLost);
		});
	}

	function showEffects(): void {
		if (!workspace?.selectedTrack) return;
		const trackId = workspace.selectedTrack.id;
		run(async () => {
			const { sessionId, project: { revision } } = workspace;
			const slots: TracktionEffectSlot[] = [];
			let offset: number | null = 0;
			while (offset !== null) {
				const page: TracktionEffectPage = await bridge.request({ kind: 'offlineEffects', sessionId, revision, trackId, offset });
				slots.push(...page.slots);
				offset = page.nextOffset;
			}
			const catalog = desktopEffects ? await bridge.request({ kind: 'offlineEffectCatalog', sessionId }) : null;
			setEffects({ slots, catalog });
		});
	}

	function scanEffects(): void {
		if (!workspace || !effects) return;
		setEffects(null);
		run(async () => {
			const catalog = await bridge.request({ kind: 'scanOfflineEffects', sessionId: workspace.sessionId });
			setEffects({ slots: effects.slots, catalog });
		});
	}

	function editEffect(selection: { installationId: string } | { slotId: string }): void {
		if (!workspace?.selectedTrack) return;
		setEffects(null);
		const { sessionId, project: { revision }, selectedTrack: { id: trackId } } = workspace;
		run(async () => {
			const result = await bridge.request('installationId' in selection
				? { kind: 'addOfflineEffect', sessionId, revision, trackId, ...selection }
				: { kind: 'removeOfflineEffect', sessionId, revision, trackId, ...selection });
			setWorkspace(await readTracktionWorkspaceWithCachedTracks(bridge, workspace, result));
		});
	}

	function finishRecording(discard: boolean): void {
		if (!workspace) return;
		run(async () => {
			const result = await bridge.request({
				kind: 'finishRecording', sessionId: workspace.sessionId, revision: workspace.project.revision, discard,
			});
			setTransport(result.transport ?? await readTransport(workspace.sessionId));
			if (result.revision !== workspace.project.revision) {
				setWorkspace(result.itemId ? await readTracktionWorkspaceAfterClipEdit(bridge, workspace, result)
					: await readTracktionWorkspace(bridge, workspace, workspace.selectedTrack?.id));
			}
			setStatus(result.itemId ? 'Recording added to the track' : discard ? 'Recording discarded' : 'No audio was recorded');
		});
	}

	return <div className="tracktion-editor" data-audio-editor-bound="true">
		<nav ref={menuBar} aria-label="Application menu">
			<details>
				<summary>File</summary>
				<div>
					<button type="button" disabled={busy || recording} onClick={() => open('create')}>{copy.newProject}</button>
					<button type="button" disabled={busy || recording} onClick={() => open('open')}>{copy.openProject}</button>
					{bridge.openArchive && <button type="button" disabled={busy || recording} onClick={() => open('archive')}>{copy.openTracktionArchive}</button>}
					<button type="button" disabled={busy || recording || !workspace?.selectedTrack} onClick={importWave}>{copy.importAudio}</button>
					<button type="button" disabled={busy || recording || !workspace} onClick={save}>{copy.saveProject}</button>
					<button type="button" disabled={busy || recording || !workspace?.tracks.some((track) => track.clipCount > 0)} onClick={() => exportProject('render')}>{copy.exportTracktionMix}</button>
					<button type="button" disabled={busy || recording || !workspace} onClick={() => exportProject('archive')}>{copy.exportTracktionArchive}</button>
					<button type="button" disabled={busy || recording || !workspace} onClick={close}>{copy.closeProject}</button>
				</div>
			</details>
			<details>
				<summary>{editCopy.editControls}</summary>
				<div>
					<button type="button" disabled={busy || recording || !workspace} onClick={() => editProject('addTrack')}>{trackCopy.addTrack}</button>
					<button type="button" disabled={busy || recording || !workspace?.selectedTrack} onClick={() => editProject('duplicateTrack')}>{trackCopy.duplicateTrack}</button>
					<button type="button" disabled={busy || recording || splittable.length === 0} onClick={() => chooseClipEdit('split')}>{editCopy.tracktionSplitClip}</button>
					<button type="button" disabled={busy || recording || !workspace?.clips.length} onClick={() => chooseClipEdit('trim')}>{editCopy.tracktionTrimClip}</button>
					<button type="button" disabled={busy || recording || !workspace?.clips.length} onClick={() => chooseClipEdit('moveClip')}>{editCopy.tracktionMoveClip}</button>
					<button type="button" disabled={busy || recording || !workspace?.clips.length} onClick={() => chooseClipEdit('duplicateClip')}>{editCopy.tracktionDuplicateClip}</button>
					<button type="button" disabled={busy || recording || !workspace?.clips.length} onClick={() => chooseClipEdit('deleteClip')}>{editCopy.liftDelete}</button>
					<button type="button" disabled={busy || recording || !workspace?.tracks.some((track) => track.clipCount > 0)} onClick={() => chooseRangeEdit('deleteRange')}>{editCopy.tracktionDeleteRange}</button>
					<button type="button" disabled={busy || recording || !workspace?.tracks.some((track) => track.clipCount > 0)} onClick={() => chooseRangeEdit('copyRange')}>{editCopy.copy}</button>
					<button type="button" disabled={busy || recording || !workspace?.tracks.some((track) => track.clipCount > 0)} onClick={() => chooseRangeEdit('cutRange')}>{editCopy.cut}</button>
					<button type="button" disabled={busy || recording || !workspace?.selectedTrack || !hasClipboard} onClick={showPaste}>{editCopy.paste}</button>
					<button type="button" disabled={busy || recording || !workspace?.selectedTrack} onClick={showMixer}>{trackCopy.mixer}</button>
					<button type="button" disabled={busy || recording || !workspace?.selectedTrack} onClick={() => showAutomation()}>{trackCopy.tracktionAutomation}</button>
					<button type="button" disabled={busy || recording || playing || !workspace?.selectedTrack} onClick={showEffects}>{tracktionEffectsTitle}</button>
					<button type="button" disabled={busy || recording || !workspace?.project.canUndo} onClick={() => editProject('undo')}>{editCopy.undo}</button>
					<button type="button" disabled={busy || recording || !workspace?.project.canRedo} onClick={() => editProject('redo')}>{editCopy.redo}</button>
				</div>
			</details>
			<details>
				<summary>{transportCopy.transport}</summary>
				<div>
					{desktopAudioSetup && <button type="button" disabled={busy || recording || !workspace || transport?.playing} onClick={showAudioSetup}>
						{AUDIO_DEVICE_COPY_BY_LOCALE.en.audioDevices}
					</button>}
					<button type="button" disabled={busy || recording || !workspace || transport?.playing} onClick={() => controlPlayback('play')}>
						{transportCopy.play}
					</button>
					<button type="button" disabled={busy || (!recording && !transport?.playing)} onClick={() => {
						if (recording) finishRecording(false);
						else controlPlayback('stop');
					}}>
						{transportCopy.stop}
					</button>
					<button type="button" disabled={busy || recording || !workspace} onClick={() => controlPlayback('seek')}>
						{transportCopy.jumpStart}
					</button>
					{recordingInput && <button type="button" disabled={busy || recording || !workspace?.selectedTrack || transport?.playing} onClick={startRecording}>
						{transportCopy.recordActiveTrack}
					</button>}
					{recording && <button type="button" disabled={busy} onClick={() => finishRecording(true)}>
						{RECORDING_RECOVERY_COPY.ordinaryRecoveryDiscard}
					</button>}
				</div>
			</details>
		</nav>
		{audioSetup && workspace && <TracktionAudioSetupDialog inventory={audioSetup} bridge={bridge} sessionId={workspace.sessionId}
			sampleRate={workspace.project.sampleRate} onDismiss={() => setAudioSetup(null)} />}
		{clipEdit && workspace?.selectedTrack && <TracktionClipEditDialog kind={clipEdit}
			tracks={workspace.tracks} sourceTrackId={workspace.selectedTrack.id} busy={busy} failure={failure}
			clips={clipEdit === 'split' ? splittable : workspace.clips} onApply={applyTimelineEdit}
			onDismiss={() => { setClipEdit(null); setFailure(''); }} />}
		{rangeEdit && workspace?.selectedTrack && <TracktionRangeEditDialog kind={rangeEdit} trackId={workspace.selectedTrack.id}
			busy={busy} failure={failure} onApply={applyTimelineEdit} onDismiss={() => { setRangeEdit(null); setFailure(''); }} />}
		{pasteFrame !== null && workspace?.selectedTrack && <TracktionPasteDialog trackId={workspace.selectedTrack.id} position={pasteFrame}
			busy={busy} failure={failure} onApply={applyTimelineEdit} onDismiss={() => { setPasteFrame(null); setFailure(''); }} />}
		{mixer && workspace?.selectedTrack && <TracktionMixerDialog track={workspace.selectedTrack.name}
			mix={mixer} onApply={applyMixer} onDismiss={() => setMixer(null)} />}
		{automation && workspace?.selectedTrack && <TracktionAutomationDialog track={workspace.selectedTrack.name} {...automation}
			busy={busy} failure={failure} onPage={showAutomation} onEdit={applyAutomation} onDismiss={() => { setAutomation(null); setFailure(''); }} />}
		{effects && workspace?.selectedTrack && <TracktionEffectsDialog track={workspace.selectedTrack.name} {...effects}
			{...(effects.catalog ? { onScan: scanEffects } : {})}
			onAdd={(installationId) => editEffect({ installationId })} onRemove={(slotId) => editEffect({ slotId })} onDismiss={() => setEffects(null)} />}
		<main aria-busy={busy}>
			<h1>{workspace?.name ?? 'Soundscaper Tracktion'}</h1>
			{visibleStatus && <p role="status">{visibleStatus}</p>}
			{failure && !automation && !rangeEdit && !clipEdit && pasteFrame === null && <p role="alert">{failure}</p>}
			{workspace && <>
				<label>{trackCopy.track} <select value={workspace.selectedTrack?.id ?? ''} disabled={busy || recording}
					onChange={(event) => selectTrack(event.currentTarget.value)}>
					{trackOptions}
				</select></label>
				<p>{workspace.clips.length} {workspace.clips.length === 1 ? 'clip' : 'clips'}</p>
				<ul aria-label="Audio clips">{clipRows}</ul>
			</>}
		</main>
	</div>;
}
