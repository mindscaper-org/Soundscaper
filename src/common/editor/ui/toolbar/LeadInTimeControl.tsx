/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Flyout } from '@soundscaper/design-system/Flyout';
import { Icon } from '@soundscaper/design-system/Icon';
import { recordingLeadInFrames } from '../../controller/recording/recording-model.ts';
import type { RecordingProject } from '../../controller/recording/recording-transaction-types.ts';
import AudioEditorTimeCodeInput, { audioEditorProjectFrameRate, audioEditorProjectSampleRate } from '../AudioEditorTimeCodeInput.tsx';
import EditorMusicalTimeCodeProvider from '../EditorMusicalTimeCodeProvider.tsx';
import EditorControlLabel from '../EditorControlLabel.tsx';
import { useMenuTriggerDismissal } from '../use-menu-trigger-dismissal.ts';

interface LeadInTimeControlProps {
	readonly copy: Readonly<{ leadInTimeOption: string; leadInTimeSettings: string; leadInDuration: string }>;
	readonly snapshot: Readonly<{
		project?: RecordingProject | null;
		selection?: Readonly<{ startFrame: number }> | null;
		recordingOptions?: Readonly<{ leadIn: boolean; leadInDurationSeconds?: number | null }>;
	}>;
	readonly controller: Readonly<{
		subscribe(listener: () => void): () => void;
		getSnapshot(): Readonly<{ project?: unknown }>;
		getTelemetrySnapshot(): Readonly<{ positionFrame?: number }>;
		actions: Readonly<{ recording: Readonly<{ toggleLeadIn(): unknown; setLeadInDuration(seconds: number): unknown }> }>;
	}>;
	readonly disabled: boolean;
	run(operation: () => unknown): unknown;
}

/** Lead-in remains opt-in; its duration editor stays inside the Record menu. */
export default function LeadInTimeControl({ copy, snapshot, controller, disabled, run }: LeadInTimeControlProps) {
	const trigger = useRef<HTMLButtonElement>(null);
	const panel = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
	const consumeTriggerDismissal = useMenuTriggerDismissal(trigger, Boolean(position));
	const close = () => {
		const active = panel.current?.ownerDocument.activeElement;
		if (active instanceof HTMLElement && panel.current?.contains(active)) active.blur();
		setPosition(null);
	};
	const project = snapshot.project;
	const sampleRate = audioEditorProjectSampleRate(project);
	const startFrame = snapshot.selection?.startFrame ?? controller.getTelemetrySnapshot().positionFrame ?? 0;
	const defaultSeconds = project ? recordingLeadInFrames(project, sampleRate, startFrame) / sampleRate : 2;
	const seconds = snapshot.recordingOptions?.leadInDurationSeconds ?? defaultSeconds;
	const closeOnEscape = (event: KeyboardEvent) => {
		if (event.key === 'Escape' && position) {
			event.preventDefault(); event.stopPropagation(); event.nativeEvent.stopImmediatePropagation();
			close(); trigger.current?.focus();
		}
	};
	return <div className="kw-audio-editor__record-flyout-lead-in">
		<label className="kw-audio-editor__record-flyout-check">
			<input type="checkbox" checked={Boolean(snapshot.recordingOptions?.leadIn)} disabled={disabled}
				onChange={() => { run(() => controller.actions.recording.toggleLeadIn()); }} />
			<EditorControlLabel>{copy.leadInTimeOption}</EditorControlLabel>
		</label>
		<button ref={trigger} type="button" className="kw-audio-editor__record-flyout-cog"
			aria-label={copy.leadInTimeSettings} aria-haspopup="dialog" aria-expanded={Boolean(position)}
			disabled={disabled} onKeyDown={closeOnEscape} data-menu-tooltip-id="recording-lead-in-settings"
			onClick={() => {
				if (consumeTriggerDismissal()) return;
				const rect = trigger.current?.getBoundingClientRect();
				if (rect) setPosition(position ? null : { x: rect.right, y: rect.top + rect.height / 2 });
			}}><Icon name="cog" size={16} /></button>
		<Flyout isOpen={Boolean(position)} onClose={close} x={position?.x ?? 0} y={position?.y ?? 0}
			direction="right" showArrow={false} triggerRef={trigger as RefObject<HTMLElement>} ariaLabel={copy.leadInTimeSettings}
			className="kw-audio-editor__record-lead-in-settings">
			<div ref={panel} onPointerDown={event => event.stopPropagation()} onKeyDown={event => {
				closeOnEscape(event);
				if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) event.stopPropagation();
			}}>
				<EditorControlLabel>{copy.leadInDuration}</EditorControlLabel>
				<EditorMusicalTimeCodeProvider controller={controller} endFrame={startFrame}>
					<AudioEditorTimeCodeInput label={copy.leadInDuration} value={seconds} unit="seconds"
						format="seconds+milliseconds" sampleRate={sampleRate} frameRate={audioEditorProjectFrameRate(project)}
						disabled={disabled} onCommit={value => run(() => controller.actions.recording.setLeadInDuration(value))} />
				</EditorMusicalTimeCodeProvider>
			</div>
		</Flyout>
	</div>;
}
