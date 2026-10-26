/* SPDX-License-Identifier: AGPL-3.0-only */
import { memo } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { Icon } from '@soundscaper/design-system/Icon';
import { AUDIO_EDITOR_FREESOUND_RESULT_DRAG_TYPE, createFreesoundResultDragPayload } from '../../project-bin-dnd.js';
import type { FreesoundPanelProps, FreesoundResultPresentation } from './FreesoundPanel.tsx';
import ccZeroIcon from './assets/cc-zero-icon.svg';
import ccByIcon from './assets/cc-by-icon.svg';
import ccNcIcon from './assets/cc-nc-icon.svg';
const LICENSE_ICONS = { cc0: ccZeroIcon, 'cc-by': ccByIcon, 'cc-by-nc': ccNcIcon };
interface Props extends Pick<FreesoundPanelProps, 'copy' | 'disabled' | 'projectBinVisible' | 'onPreview' | 'onPausePreview' | 'onResumePreview' | 'onSeekPreview' | 'onInsertAtPlayhead' | 'onAddToProjectBin'> {
	readonly result: FreesoundResultPresentation;
	readonly previewing: boolean;
	readonly playing: boolean;
	readonly positionSeconds: number;
}
export const FreesoundResultRow = memo(function FreesoundResultRow({ result, previewing, playing, positionSeconds, copy, disabled, projectBinVisible, onPreview, onPausePreview, onResumePreview, onSeekPreview, onInsertAtPlayhead, onAddToProjectBin }: Props) {
	const positionPercent = result.durationSeconds > 0
		? Math.min(100, Math.max(0, 100 * positionSeconds / result.durationSeconds))
		: 0;
	const previewPlayhead = previewing ? <span className="kw-audio-editor__freesound-preview-playhead"
		aria-hidden="true" style={{ left: `${positionPercent}%` }} /> : null;
	const previewLabel = playing ? copy.pausePreview : copy.playPreview;
	const mutationDisabled = disabled || result.actionPending === true;
	return (
		<li
			key={result.soundId}
			className="kw-audio-editor__freesound-result"
			data-freesound-sound-id={result.soundId}
			draggable={!mutationDisabled}
			onDragStart={(event) => {
				if (mutationDisabled) {
					event.preventDefault();
					return;
				}
				event.dataTransfer.clearData();
				event.dataTransfer.effectAllowed = 'copy';
				event.dataTransfer.setData(
					AUDIO_EDITOR_FREESOUND_RESULT_DRAG_TYPE,
					createFreesoundResultDragPayload(result.soundId),
				);
			}}
		>
			<div className="kw-audio-editor__freesound-result-meta">
				<a className="kw-audio-editor__freesound-result-name" href={result.soundUrl}
					title={result.name} target="_blank" rel="noreferrer">{result.name}</a>
				<span className="kw-audio-editor__freesound-result-author">
					{copy.byInline}{' '}
					{result.userUrl
						? <a href={result.userUrl} target="_blank" rel="noreferrer">{result.username}</a>
						: result.username}
				</span>
				<span className="kw-audio-editor__freesound-result-duration">{result.durationLabel}</span>
			</div>
			<div className="kw-audio-editor__freesound-result-preview">
				<button
					type="button"
					className="kw-audio-editor__freesound-preview-button"
					disabled={result.previewAvailable === false}
					aria-label={`${previewLabel}: ${result.name}`}
					aria-pressed={playing}
					onClick={() => playing ? onPausePreview() : previewing ? onResumePreview() : onPreview(result.soundId)}
				>
					<Icon name={playing ? 'pause' : 'play'} size={16} />
				</button>
				{result.waveformUrl ? <button
					type="button" role="slider" aria-orientation="horizontal"
					aria-valuemin={0} aria-valuemax={result.durationSeconds}
					aria-valuenow={previewing ? positionSeconds : 0}
					className="kw-audio-editor__freesound-waveform"
					disabled={result.previewAvailable === false}
					aria-label={`${copy.seekPreview}: ${result.name}`}
					onKeyDown={(event) => {
						const position = previewing ? positionSeconds : 0;
						const step = Math.min(1, result.durationSeconds / 100) * (event.shiftKey ? 10 : 1);
						const next = event.key === 'Home' ? 0 : event.key === 'End' ? result.durationSeconds
							: event.key === 'ArrowRight' || event.key === 'ArrowUp' ? position + step
							: event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? position - step : null;
						if (next === null) return;
						event.preventDefault();
						onSeekPreview(result.soundId, Math.max(0, Math.min(result.durationSeconds, next)));
					}}
					onClick={(event) => onSeekPreview(result.soundId, event.detail === 0 ? (previewing ? positionSeconds : 0) : waveformSeekSeconds(
						event.clientX,
						event.currentTarget.getBoundingClientRect(),
						result.durationSeconds,
					))}
				>
					<img src={result.waveformUrl} alt="" loading="lazy" draggable={false} />
					{previewPlayhead}
				</button> : <span className="kw-audio-editor__freesound-waveform">{previewPlayhead}</span>}
			</div>
			<div className="kw-audio-editor__freesound-result-actions">
				<a className="kw-audio-editor__freesound-result-license" href={result.licenseUrl}
					aria-label={result.licenseName} target="_blank" rel="noreferrer">
					<img src={LICENSE_ICONS[result.licenseCode]} alt="" />
				</a>
				<Button
					size="small"
					icon={<span aria-hidden="true">{'\uF3B0'}</span>}
					disabled={mutationDisabled}
					onClick={() => onInsertAtPlayhead(result.soundId)}
				>
					{copy.insertAtPlayhead}
					<span className="kw-audio-editor-sr-only">: {result.name}</span>
				</Button>
				{projectBinVisible ? <Button
					size="small"
					icon={<span aria-hidden="true">{'\uF3AF'}</span>}
					disabled={mutationDisabled}
					onClick={() => onAddToProjectBin(result.soundId)}
				>
					{copy.addToProjectBin}
					<span className="kw-audio-editor-sr-only">: {result.name}</span>
				</Button> : null}
			</div>
		</li>
	);
});

function waveformSeekSeconds(
	clientX: number,
	bounds: Readonly<Pick<DOMRect, 'left' | 'width'>>,
	durationSeconds: number,
): number {
	if (!Number.isFinite(clientX) || bounds.width <= 0 || durationSeconds <= 0) return 0;
	const fraction = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
	return fraction * durationSeconds;
}
