/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useState } from 'react';
import { PreferencePanel } from '@soundscaper/design-system/PreferencePanel';

import { AudioDevicesFlyout } from '../toolbar/AudioDevicesFlyout.jsx';
import { recordingOffsetSources } from './editor-dialog-model.js';
import RecordingOffsetInput from './RecordingOffsetInput.tsx';

/** Shared host, device, and next-recording settings for Preferences and Audio setup. */
export default function AudioSettingsPreferencesPage({ controller, snapshot, copy, run, displayAudioSupported = true }) {
	const [requestedSourceKey, setSourceKey] = useState('global');
	const sources = recordingOffsetSources(snapshot, copy);
	const sourceKey = sources.some((source) => source.key === requestedSourceKey) ? requestedSourceKey : 'global';
	useEffect(() => { if (sourceKey !== requestedSourceKey) setSourceKey(sourceKey); }, [requestedSourceKey, sourceKey]);
	const sourceOffset = sourceKey === 'global'
		? snapshot.monitor?.latencyOffsetMs ?? 0
		: snapshot.recordingInputs?.offsets?.[sourceKey] ?? 0;
	return (
		<>
			<PreferencePanel title={copy.preferencesAudioSettings}>
				<AudioDevicesFlyout
					copy={copy}
					snapshot={snapshot}
					controller={controller}
					run={run}
					displayAudioSupported={displayAudioSupported}
					heading={false}
				/>
			</PreferencePanel>
			<PreferencePanel title={copy.recordingOffset}>
				<div className="kw-audio-editor-preferences__grid">
					<label className="kw-audio-editor-preferences__field">
						<span>{copy.recordingOffsetSource}</span>
						<select value={sourceKey} onChange={(event) => setSourceKey(event.currentTarget.value)}>
							{sources.map((source) => (
								<option key={source.key} value={source.key}>{source.label}</option>
							))}
						</select>
					</label>
					<label className="kw-audio-editor-preferences__field">
						<span>{copy.latencyOffset}</span>
						<RecordingOffsetInput key={sourceKey} label={copy.latencyOffset} value={sourceOffset}
							onCommit={(offset) => run(() => sourceKey === 'global'
								? controller.actions.recording.setLatencyOffset(offset)
								: controller.actions.recording.setSourceOffset(sourceKey, offset))} />
					</label>
				</div>
			</PreferencePanel>
		</>
	);
}
