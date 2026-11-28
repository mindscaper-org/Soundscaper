/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useState, type FormEvent } from 'react';

import { AUDIO_DEVICE_COPY_BY_LOCALE } from '../../common/i18n/audio-device-copy.js';
import { CLIP_INTERACTIONS_COPY_BY_LOCALE } from '../../common/i18n/editor-clip-interactions-copy.ts';
import { PROJECT_COMMAND_COPY_BY_LOCALE } from '../../common/i18n/project-command-copy.js';
import type { TracktionAudioDevices, TracktionAudioHosts } from '../tracktion-audio-device-contract.ts';
import type { TracktionProjectBridge } from '../tracktion-project-contract.ts';
import { useTracktionModalDialog } from './useTracktionModalDialog.ts';

const copy = AUDIO_DEVICE_COPY_BY_LOCALE.en;

export function TracktionAudioSetupDialog({ inventory, bridge, sessionId, sampleRate, onDismiss }: {
	readonly inventory: TracktionAudioHosts;
	readonly bridge: TracktionProjectBridge;
	readonly sessionId: string;
	readonly sampleRate: number;
	readonly onDismiss: () => void;
}) {
	const selected = inventory.selected?.setup ?? inventory.preferred ?? undefined;
	const [hostId, setHostId] = useState(() => selected?.hostId ?? inventory.hosts[0]?.id ?? '');
	const [hosts, setHosts] = useState(inventory.hosts);
	const [devices, setDevices] = useState<TracktionAudioDevices | null>(null);
	const [draft, setDraft] = useState<FormData | null>(null);
	const [refresh, setRefresh] = useState(0);
	const [pending, setPending] = useState(false);
	const [failure, setFailure] = useState('');
	const dialog = useTracktionModalDialog();
	useEffect(() => {
		if (!hostId) return;
		let mounted = true;
		void bridge.request({ kind: 'audioDevices', sessionId, hostId }).then((result) => {
			if (mounted) setDevices(result);
		}).catch((error: unknown) => {
			if (mounted) setFailure(error instanceof Error ? error.message : String(error));
		});
		return () => { mounted = false; };
	}, [bridge, hostId, refresh, sessionId]);

	async function apply(form: FormData): Promise<void> {
		if (pending || !devices) return;
		setPending(true);
		setFailure('');
		try {
			const result = await bridge.request({
				kind: 'setAudioSetup', sessionId, hostId,
				inputId: String(form.get('inputId') ?? ''), outputId: String(form.get('outputId') ?? ''),
				inputChannel: Number(form.get('inputChannel')) - 1,
				outputChannel: Number(form.get('outputChannel')) - 1,
				sampleRate: Number(form.get('sampleRate')), blockSize: Number(form.get('blockSize')),
			});
			if (result.preferencesSaved === false) {
				setFailure(copy.tracktionAudioPreferencesNotSaved);
				return;
			}
			onDismiss();
		} catch (error) {
			setFailure(error instanceof Error ? error.message : String(error));
		} finally {
			setPending(false);
		}
	}

	function reload(nextHost: string, nextDraft: FormData | null = null): void {
		setDraft(nextDraft);
		setDevices(null);
		setFailure('');
		setHostId(nextHost);
		setRefresh((value) => value + 1);
	}

	async function refreshInventory(form: HTMLFormElement | null): Promise<void> {
		if (pending || loading) return;
		const currentDraft = devices && form ? new FormData(form) : draft;
		setPending(true);
		setFailure('');
		try {
			const result = await bridge.request({ kind: 'audioHosts', sessionId });
			setHosts(result.hosts);
			reload(hostId || result.hosts[0]?.id || '', currentDraft);
		} catch (error) {
			setFailure(error instanceof Error ? error.message : String(error));
		} finally {
			setPending(false);
		}
	}

	function submit(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		void apply(new FormData(event.currentTarget));
	}

	const previous = selected?.hostId === hostId ? selected : undefined;
	const value = (field: string, fallback: string | number) => String(draft?.get(field) ?? fallback);
	const outputId = value('outputId', previous?.outputId ?? '');
	const inputId = value('inputId', previous?.inputId ?? '');
	const loading = Boolean(hostId && !devices && !failure);
	return <dialog ref={dialog} aria-label={copy.audioDevices} onCancel={(event) => {
		event.preventDefault();
		if (!pending && !loading) onDismiss();
	}}>
		<h2>{copy.audioDevices}</h2>
		<form onSubmit={submit}>
			<p><label>{copy.audioDeviceHost} <select name="hostId" value={hostId} disabled={pending || loading}
				onChange={(event) => reload(event.currentTarget.value)}>
				{hostId && !hosts.some((host) => host.id === hostId) && <option value={hostId}>{copy.audioDevicePreferredUnavailable}</option>}
				{hosts.map((host) => <option key={host.id} value={host.id}>{host.name}</option>)}
			</select></label>{' '}
			<button type="button" onClick={(event) => { void refreshInventory(event.currentTarget.form); }} disabled={pending || loading}>
				{copy.audioDeviceRefresh}
			</button></p>
			{!hosts.length && <p role="status">{copy.audioHostInventoryUnavailable}</p>}
			{devices && <fieldset key={hostId + ':' + String(refresh)} disabled={pending}>
				<p><label>{copy.audioOutputDevice} <select name="outputId" defaultValue={outputId}>
					<option value="">{copy.audioDeviceSystemDefault}</option>
					{outputId && !devices.outputs.some((output) => output.id === outputId)
						&& <option value={outputId}>{copy.audioDevicePreferredUnavailable}</option>}
					{devices.outputs.map((output) => <option key={output.id} value={output.id}>{output.name}</option>)}
				</select></label></p>
				{devices.separateDevices && <p><label>{copy.audioInputDevice} <select name="inputId" defaultValue={inputId}>
					<option value="">{copy.audioDeviceSystemDefault}</option>
					{inputId && !devices.inputs.some((input) => input.id === inputId)
						&& <option value={inputId}>{copy.audioDevicePreferredUnavailable}</option>}
					{devices.inputs.map((input) => <option key={input.id} value={input.id}>{input.name}</option>)}
				</select></label></p>}
				<p><label>{copy.tracktionCaptureChannel} <input name="inputChannel" type="number" required min="1" max="64"
					defaultValue={value('inputChannel', (previous?.inputChannel ?? 0) + 1)} /></label></p>
				<p><label>{copy.tracktionStereoPairStart} <input name="outputChannel" type="number" required min="1" max="63"
					defaultValue={value('outputChannel', (previous?.outputChannel ?? 0) + 1)} /></label></p>
				<p><label>{copy.tracktionDeviceSampleRate} <input name="sampleRate" type="number" min="22050" max="192000"
					placeholder={copy.audioDeviceSystemDefault} defaultValue={value('sampleRate', (previous?.sampleRate ?? (sampleRate >= 22_050 ? sampleRate : 0)) || '')} /></label></p>
				<p><label>{copy.tracktionDeviceBufferSize} <input name="blockSize" type="number" min="1" max="8192"
					placeholder={copy.audioDeviceSystemDefault} defaultValue={value('blockSize', previous?.blockSize || '')} /></label></p>
			</fieldset>}
			{failure && <p role="alert">{failure}</p>}
			<button type="submit" disabled={pending || !devices?.outputs.length}>{CLIP_INTERACTIONS_COPY_BY_LOCALE.en.apply}</button>{' '}
			<button type="button" disabled={pending || loading} onClick={onDismiss}>{PROJECT_COMMAND_COPY_BY_LOCALE.en.cancel}</button>
		</form>
	</dialog>;
}
