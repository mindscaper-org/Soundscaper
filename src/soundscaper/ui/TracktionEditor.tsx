/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { AUDIO_DEVICE_COPY_BY_LOCALE } from '../../common/i18n/audio-device-copy.js';
import { EDIT_COMMAND_COPY_BY_LOCALE } from '../../common/i18n/edit-command-copy.js';
import { RECORDING_RECOVERY_COPY } from '../../common/i18n/editor-recording-recovery-copy.ts';
import { PROJECT_COMMAND_COPY_BY_LOCALE } from '../../common/i18n/project-command-copy.js';
import { TRACK_COPY_BY_LOCALE } from '../../common/i18n/track-copy.js';
import { TRANSPORT_COPY_BY_LOCALE } from '../../common/i18n/transport-copy.js';
import type { TracktionAudioHosts } from '../tracktion-audio-device-contract.ts';
import type { TracktionEffectInstallation, TracktionEffectPage, TracktionEffectSlot } from '../tracktion-effect-contract.ts';
import type { TracktionClipCommand, TracktionProjectBridge, TracktionRangeCommand, TracktionTrackMix, TracktionTransportView } from '../tracktion-project-contract.ts';
import { startTracktionPlayback } from '../tracktion-transport.ts';
import { readTracktionClips, readTracktionWorkspace, type TracktionWorkspace } from '../tracktion-workspace.ts';
import { TracktionAudioSetupDialog } from './TracktionAudioSetupDialog.tsx';
import { TracktionClipEditDialog } from './TracktionClipEditDialog.tsx';
import { TracktionEffectsDialog, tracktionEffectsTitle } from './TracktionEffectsDialog.tsx';
import { TracktionMixerDialog } from './TracktionMixerDialog.tsx';
import { TracktionRangeDeleteDialog } from './TracktionRangeDeleteDialog.tsx';

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
	const [transport, setTransport] = useState<TracktionTransportView | null>(null);
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState('');
	const [failure, setFailure] = useState('');
	const [clipEdit, setClipEdit] = useState<TracktionClipCommand['kind'] | null>(null);
	const [rangeDelete, setRangeDelete] = useState(false);
	const [mixer, setMixer] = useState<TracktionTrackMix | null>(null);
	const [audioSetup, setAudioSetup] = useState<TracktionAudioHosts | null>(null);
	const [effects, setEffects] = useState<{ slots: TracktionEffectSlot[]; catalog: readonly TracktionEffectInstallation[] | null } | null>(null);
	const pending = useRef(false);
	const transportProbe = useRef<Promise<void> | null>(null);
	const dirty = workspace !== null && workspace.project.revision !== savedRevision;
	const recording = transport?.recording === true;
	const playing = transport?.playing === true;
	const menuBar = useRef<HTMLElement>(null);
	const splittable = workspace?.clips.filter((clip) => clip.end - clip.start > 1) ?? [];

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

	const observeNativeTransport = useEffectEvent((isCurrent: () => boolean) => {
		if (!workspace || pending.current || transportProbe.current) return;
		const probe = bridge.request({ kind: 'transportStatus', sessionId: workspace.sessionId }).then(async (next) => {
			const take = next.interruptedTake;
			const lostOutput = next.outputInterrupted && (next.recording || !next.playing) && !transport?.outputInterrupted;
			if ((!take && !lostOutput) || !isCurrent() || pending.current) return;
			const updated = take?.itemId ? await readTracktionWorkspace(bridge, workspace, workspace.selectedTrack?.id) : workspace;
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

	function open(kind: 'open' | 'create' | 'archive'): void {
		if (!confirmReplacement()) return;
		run(async () => {
			const opened = kind === 'archive' ? await bridge.openArchive?.()
				: await bridge.request(kind === 'create' ? { kind, sampleRate: 48_000 } : { kind });
			if (!opened) return;
			const next = await readTracktionWorkspace(bridge, opened);
			setTransport(await bridge.request({ kind: 'transportStatus', sessionId: opened.sessionId }));
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

	function importWave(): void {
		if (!workspace?.selectedTrack) return;
		const trackId = workspace.selectedTrack.id;
		const start = workspace.clips.reduce((end, clip) => Math.max(end, clip.end), 0);
		run(async () => {
			const result = await bridge.request({
				kind: 'import', sessionId: workspace.sessionId, revision: workspace.project.revision, trackId, start,
			});
			if (result) setWorkspace(await readTracktionWorkspace(bridge, workspace, trackId));
		});
	}

	function editProject(kind: 'addTrack' | 'undo' | 'redo'): void {
		if (!workspace) return;
		run(async () => {
			const command = { sessionId: workspace.sessionId, revision: workspace.project.revision };
			const result = await bridge.request(kind === 'addTrack'
				? { ...command, kind, name: `${trackCopy.audioTrack} ${workspace.tracks.length + 1}` }
				: { ...command, kind });
			setWorkspace(await readTracktionWorkspace(bridge, workspace, result.itemId ?? workspace.selectedTrack?.id));
		});
	}

	function chooseClipEdit(kind: TracktionClipCommand['kind']): void {
		closeMenus();
		setClipEdit(kind);
	}

	function applyTimelineEdit(edit: TracktionClipCommand | TracktionRangeCommand): void {
		setClipEdit(null);
		setRangeDelete(false);
		if (!workspace) return;
		run(async () => {
			await bridge.request({ ...edit, sessionId: workspace.sessionId, revision: workspace.project.revision });
			const selectedTrack = ('trackId' in edit ? edit.trackId : null) ?? workspace.selectedTrack?.id;
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
			await bridge.request({ ...mix, kind: 'setTrackMix', trackId, sessionId: workspace.sessionId, revision: workspace.project.revision });
			setWorkspace(await readTracktionWorkspace(bridge, workspace, trackId));
		});
	}

	function exportProject(format: 'archive' | 'render'): void {
		if (!workspace) return;
		run(async () => {
			const { sessionId } = workspace;
			const { revision } = workspace.project;
			if (format === 'archive') {
				await bridge.request({ kind: format, sessionId, revision });
				return;
			}
			let end = 0;
			for (const track of workspace.tracks) {
				if (track.clipCount === 0) continue;
				const clips = track.id === workspace.selectedTrack?.id ? workspace.clips
					: await readTracktionClips(bridge, sessionId, revision, track.id);
				for (const clip of clips) end = Math.max(end, clip.end);
			}
			if (end > 0) await bridge.request({ kind: format, sessionId, revision, start: 0, end });
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
			setStatus(next.playing ? 'Playing' : 'Stopped');
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
			await bridge.request('installationId' in selection
				? { kind: 'addOfflineEffect', sessionId, revision, trackId, ...selection }
				: { kind: 'removeOfflineEffect', sessionId, revision, trackId, ...selection });
			setWorkspace(await readTracktionWorkspace(bridge, workspace, trackId));
		});
	}

	function finishRecording(discard: boolean): void {
		if (!workspace) return;
		run(async () => {
			const result = await bridge.request({
				kind: 'finishRecording', sessionId: workspace.sessionId, revision: workspace.project.revision, discard,
			});
			setTransport(await bridge.request({ kind: 'transportStatus', sessionId: workspace.sessionId }));
			if (result.itemId) {
				setWorkspace(await readTracktionWorkspace(bridge, workspace, workspace.selectedTrack?.id));
				setStatus('Recording added to the track');
			} else {
				setStatus(discard ? 'Recording discarded' : 'No audio was recorded');
			}
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
					<button type="button" disabled={busy || recording || splittable.length === 0} onClick={() => chooseClipEdit('split')}>{editCopy.tracktionSplitClip}</button>
					<button type="button" disabled={busy || recording || !workspace?.clips.length} onClick={() => chooseClipEdit('trim')}>{editCopy.tracktionTrimClip}</button>
					<button type="button" disabled={busy || recording || !workspace?.clips.length} onClick={() => chooseClipEdit('moveClip')}>{editCopy.tracktionMoveClip}</button>
					<button type="button" disabled={busy || recording || !workspace?.clips.length} onClick={() => chooseClipEdit('duplicateClip')}>{editCopy.tracktionDuplicateClip}</button>
					<button type="button" disabled={busy || recording || !workspace?.clips.length} onClick={() => chooseClipEdit('deleteClip')}>{editCopy.liftDelete}</button>
					<button type="button" disabled={busy || recording || !workspace?.tracks.some((track) => track.clipCount > 0)} onClick={() => {
						closeMenus();
						setRangeDelete(true);
					}}>{editCopy.tracktionDeleteRange}</button>
					<button type="button" disabled={busy || recording || !workspace?.selectedTrack} onClick={showMixer}>{trackCopy.mixer}</button>
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
			tracks={workspace.tracks} sourceTrackId={workspace.selectedTrack.id}
			clips={clipEdit === 'split' ? splittable : workspace.clips} onApply={applyTimelineEdit} onDismiss={() => setClipEdit(null)} />}
		{rangeDelete && workspace?.selectedTrack && <TracktionRangeDeleteDialog trackId={workspace.selectedTrack.id}
			onApply={applyTimelineEdit} onDismiss={() => setRangeDelete(false)} />}
		{mixer && workspace?.selectedTrack && <TracktionMixerDialog track={workspace.selectedTrack.name}
			mix={mixer} onApply={applyMixer} onDismiss={() => setMixer(null)} />}
		{effects && workspace?.selectedTrack && <TracktionEffectsDialog track={workspace.selectedTrack.name} {...effects}
			{...(effects.catalog ? { onScan: scanEffects } : {})}
			onAdd={(installationId) => editEffect({ installationId })} onRemove={(slotId) => editEffect({ slotId })} onDismiss={() => setEffects(null)} />}
		<main aria-busy={busy}>
			<h1>{workspace?.name ?? 'Soundscaper Tracktion'}</h1>
			{(recording || status) && <p role="status">{recording ? 'Recording' : status}</p>}
			{failure && <p role="alert">{failure}</p>}
			{workspace && <>
				<label>{trackCopy.track} <select value={workspace.selectedTrack?.id ?? ''} disabled={busy || recording} onChange={(event) => {
					const trackId = event.currentTarget.value;
					run(async () => setWorkspace(await readTracktionWorkspace(bridge, workspace, trackId)));
				}}>
					{workspace.tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}
				</select></label>
				<p>{workspace.clips.length} {workspace.clips.length === 1 ? 'clip' : 'clips'}</p>
				<ul aria-label="Audio clips">
					{workspace.clips.map((clip) => <li key={clip.id}>{clip.name} ({clip.start}–{clip.end})</li>)}
				</ul>
			</>}
		</main>
	</div>;
}
