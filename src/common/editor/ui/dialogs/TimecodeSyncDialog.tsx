/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { resolveTimecodeSyncCopy } from '../../../i18n/editor-timecode-sync-copy.ts';
import { createTimecodeSyncSession, DEFAULT_TIMECODE_SYNC_SETTINGS, type TimecodeDevices, type TimecodeSyncSettings } from '../../controller/transport/timecode-sync-session.ts';
import { createBrowserTimecodeSyncIo } from '../../controller/transport/timecode-sync-browser.ts';
import { workspaceTimecodeRuntime, type TimecodeWorkspaceController } from '../workspace/timecode-sync-workspace.ts';
import EditorControlLabel from '../EditorControlLabel.tsx';

const EMPTY_DEVICES: TimecodeDevices = { midiInputs: [], midiOutputs: [], audioInputs: [], audioOutputs: [] };
export default function TimecodeSyncDialog({ controller, copy: copyInput, onClose }: {
	readonly controller: TimecodeWorkspaceController;
	readonly copy: Readonly<Record<string, unknown>>;
	readonly onClose: () => void;
}) {
	const copy = resolveTimecodeSyncCopy(copyInput);
	const runtime = workspaceTimecodeRuntime(controller, () => {
		const io = createBrowserTimecodeSyncIo();
		const session = createTimecodeSyncSession({ io,
			read: () => {
				const state = controller.engine.getState(), snapshot = controller.getSnapshot();
				return { projectId: controller.project?.id ?? null, sampleRate: controller.project?.sampleRate ?? 48000,
					positionFrame: controller.engine.getPositionFrames(), playing: state.state === 'playing', speed: state.playbackRate,
					blocked: snapshot.phase === 'disposing' || snapshot.phase === 'disposed' || snapshot.projectActivationPending === true || snapshot.projectAdministrationPending === true,
					receiveBlocked: snapshot.transportState === 'recording' || snapshot.recordingStarting === true || snapshot.recordingScheduling === true || Boolean(snapshot.scheduledRecording) || controller.project?.loop?.enabled === true || state.playbackRate !== 1 || state.cutPreview === true };
			},
			seek: frame => controller.actions.transport.seek(frame),
			play: async () => { if (controller.engine.getState().state !== 'playing') await controller.actions.transport.playPause(); },
			pause: async () => { const frame = controller.engine.getPositionFrames(); await controller.actions.transport.stop(); controller.actions.transport.seek(frame); },
		});
		return { io, session };
	});
	const snapshot = useSyncExternalStore(runtime.session.subscribe, runtime.session.getSnapshot);
	const [draft, setDraft] = useState<TimecodeSyncSettings>(snapshot.settings);
	const [devices, setDevices] = useState(EMPTY_DEVICES);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		let current = true;
		void runtime.io.devices(false).then(value => { if (current) setDevices(value); }, (failure: unknown) => { if (current) setError(String(failure)); });
		return () => { current = false; };
	}, [runtime]);
	const run = (operation: () => Promise<unknown>): void => {
		setBusy(true); setError('');
		void operation().catch((failure: unknown) => { setError(failure instanceof Error ? failure.message : String(failure)); }).finally(() => { setBusy(false); });
	};
	const update = <Key extends keyof TimecodeSyncSettings>(key: Key, value: TimecodeSyncSettings[Key]): void => { setDraft(current => ({ ...current, [key]: value })); };
	const port = (key: 'midiInput' | 'midiOutput' | 'audioInput' | 'audioOutput', label: string, choices: readonly { id: string; name: string }[]) => <label>
		<EditorControlLabel>{label}</EditorControlLabel><select aria-label={label} value={draft[key]} onChange={event => update(key, event.currentTarget.value)}>
			<option value="">{key.startsWith('midi') ? copy.selectPort : copy.defaultDevice}</option>
			{choices.filter(device => device.id !== '').map(device => <option key={device.id} value={device.id}>{device.name}</option>)}
		</select>
	</label>;
	return <AudioEditorDialogShell title={copy.title} onClose={onClose} width={620} footer={<DialogFooter
		className="audio-editor-dialog-footer"
		leftContent={<Button onClick={() => run(async () => { await runtime.session.configure(DEFAULT_TIMECODE_SYNC_SETTINGS); setDraft(DEFAULT_TIMECODE_SYNC_SETTINGS); })}>{copy.disable}</Button>}
		rightContent={<><Button onClick={onClose}>{copy.close}</Button><Button variant="primary" disabled={busy} onClick={() => run(() => runtime.session.configure(draft))}>{copy.apply}</Button></>}
	/>}>
		<p>{copy.hint}</p>
		<fieldset disabled={busy} style={{ display: 'grid', gap: 12 }}>
			<label><EditorControlLabel>{copy.receive}</EditorControlLabel><select aria-label={copy.receive} value={draft.receive} onChange={event => update('receive', event.currentTarget.value as TimecodeSyncSettings['receive'])}>
				<option value="off">{copy.off}</option><option value="mtc">{copy.mtc}</option><option value="ltc">{copy.ltc}</option>
			</select></label>
			<label><input type="checkbox" checked={draft.sendMtc} onChange={event => update('sendMtc', event.currentTarget.checked)} /><EditorControlLabel>{copy.sendMtc}</EditorControlLabel></label>
			<label><input type="checkbox" checked={draft.sendLtc} onChange={event => update('sendLtc', event.currentTarget.checked)} /><EditorControlLabel>{copy.sendLtc}</EditorControlLabel></label>
			<label><EditorControlLabel>{copy.rate}</EditorControlLabel><select aria-label={copy.rate} value={draft.rate} onChange={event => update('rate', event.currentTarget.value as TimecodeSyncSettings['rate'])}>
				<option value="24">{copy.fps24}</option><option value="25">{copy.fps25}</option><option value="29.97df">{copy.fps2997}</option><option value="30">{copy.fps30}</option>
			</select></label>
			<label><EditorControlLabel>{copy.offset}</EditorControlLabel><input aria-label={copy.offset} type="number" min={-86400} max={86400} step="any" value={Number.isFinite(draft.offsetSeconds) ? draft.offsetSeconds : ''} onChange={event => update('offsetSeconds', event.currentTarget.valueAsNumber)} /></label>
			{(draft.sendMtc || draft.receive === 'mtc') && <>
				<Button onClick={() => run(async () => { setDevices(await runtime.io.devices(true)); })}>{copy.midiAccess}</Button>
				{draft.receive === 'mtc' && port('midiInput', copy.midiInput, devices.midiInputs)}
				{draft.sendMtc && port('midiOutput', copy.midiOutput, devices.midiOutputs)}
			</>}
			{(draft.sendLtc || draft.receive === 'ltc') && <>
				<p>{copy.routingHint}</p>
				<Button onClick={() => run(async () => { setDevices(await runtime.io.devices(false)); })}>{copy.refresh}</Button>
				{draft.receive === 'ltc' && port('audioInput', copy.audioInput, devices.audioInputs)}
				{draft.sendLtc && port('audioOutput', copy.audioOutput, devices.audioOutputs)}
				{(['inputChannel', 'outputChannel'] as const).filter(key => key === 'inputChannel' ? draft.receive === 'ltc' : draft.sendLtc).map(key => <label key={key}>
					<EditorControlLabel>{copy[key]}</EditorControlLabel><input aria-label={copy[key]} type="number" min={1} max={32} value={Number.isFinite(draft[key]) ? draft[key] + 1 : ''} onChange={event => update(key, event.currentTarget.valueAsNumber - 1)} />
				</label>)}
			</>}
		</fieldset>
		<p role="status">{snapshot.active ? snapshot.settings.receive !== 'off' ? snapshot.locked ? copy.locked : copy.waiting : copy.sending : copy.inactive}</p>
		{(error || snapshot.error) && <p role="alert">{error || snapshot.error}</p>}
	</AudioEditorDialogShell>;
}
