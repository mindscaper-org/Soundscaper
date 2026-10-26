/* SPDX-License-Identifier: AGPL-3.0-only */
import { Button } from '@soundscaper/design-system/Button';
import type { PropertyClip, PropertySource } from './clip-properties-upstream-model.ts';
import ClipAudioFormatSection, { type ClipAudioFormatRequest } from './ClipAudioFormatSection.tsx';

export interface ClipMediaActions {
	update(id: string, changes: Readonly<Record<string, unknown>>): unknown;
	toggleStretchToTempo(id: string): unknown;
	renderPitchSpeed(id: string): unknown;
	normalizePeak(id: string): unknown;
	normalizeLoudness(id: string): unknown;
	reinterpret(id: string, request: ClipAudioFormatRequest): unknown;
	resample(id: string, request: ClipAudioFormatRequest): unknown;
}

interface Props {
	readonly clips: readonly PropertyClip[];
	readonly source?: PropertySource;
	readonly copy: Readonly<Record<string, string>>;
	readonly actions: ClipMediaActions;
	readonly disabled: boolean;
	readonly run: (operation: () => unknown) => unknown;
	readonly update: (changes: (clip: PropertyClip) => Readonly<Record<string, unknown>>) => unknown;
	readonly setTimePitch: (changes: Readonly<Record<string, unknown>>) => unknown;
}

function PhaseGlyph() {
	return <svg className="clip-properties__glyph" data-glyph="Phase" viewBox="0 0 16 16" width={16} height={16} aria-hidden="true">
		<circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
		<path d="m3 14 10-12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
	</svg>;
}

export function ClipPitchUnitToggle({ unit, onChange, copy }: {
	readonly unit: 'percent' | 'semitones';
	readonly onChange: (unit: 'percent' | 'semitones') => void;
	readonly copy: Readonly<Record<string, string>>;
}) {
	const label = unit === 'percent' ? copy.clipPitchUnitPercent : copy.clipPitchUnitSemitones;
	return <button type="button" className="audio-editor-clip-pitch-unit" data-clip-pitch-unit
		aria-label={`${copy.clipPitchUnit}: ${label}`} title={label} aria-pressed={unit === 'percent'}
		onClick={() => onChange(unit === 'percent' ? 'semitones' : 'percent')}>
		{unit === 'percent' ? '%' : <svg data-glyph="Tuning fork" width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
			<path d="M5 2v4a3 3 0 0 0 6 0V2M8 9v5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</svg>}
	</button>;
}

/** Host operations occupy slots in the upstream panel without duplicating its fields. */
export function clipAudioPropertyControls({ clips, source, copy, actions, disabled, run, update, setTimePitch }: Props) {
	const clip = clips[0];
	const single = clips.length === 1 && clip;
	const mixedFlag = (field: 'inverted' | 'preserveFormants' | 'stretchToTempo') => clips.every(clip => Boolean(clip[field]) === Boolean(clips[0]?.[field])) ? Boolean(clips[0]?.[field]) : 'mixed';
	const inverted = mixedFlag('inverted'), voice = mixedFlag('preserveFormants'), stretch = mixedFlag('stretchToTempo');
	const renderDisabled = disabled || !single || ((clip.speedRatio ?? 1) === 1 && (clip.linkPitchAndTempo || (clip.pitchCents ?? 0) === 0));
	return {
		heading: <label className="audio-editor-clip-voice" data-clip-properties-field="voice">
			<input type="checkbox" checked={voice === true} aria-checked={voice} disabled={disabled}
				ref={node => { if (node) node.indeterminate = voice === 'mixed'; }}
				onChange={event => setTimePitch({ preserveFormants: event.currentTarget.checked })} />
			<span>{copy.clipOptimizeVoice}</span>
		</label>,
		invert: <button type="button" className="clip-properties__field clip-properties__field--toggle"
			data-clip-properties-field="invert" role={inverted === 'mixed' ? 'checkbox' : 'switch'} aria-checked={inverted} disabled={disabled}
			onClick={() => update(() => ({ inverted: inverted !== true }))}>
			<span className="clip-properties__glyph-cell"><PhaseGlyph /></span><span className="clip-properties__value">{copy.invert}</span>
			<span className="clip-properties__switch" aria-hidden="true" />
		</button>,
		action: <Button variant="secondary" data-clip-properties-action="render-pitch-speed" title={copy.renderPitchSpeed}
			disabled={renderDisabled} onClick={() => { if (single) run(() => actions.renderPitchSpeed(clip.id)); }}>{copy.render}</Button>,
		footer: <div className="clip-properties__row"><button type="button" role={stretch === 'mixed' ? 'checkbox' : 'switch'} aria-checked={stretch}
			className="clip-properties__field clip-properties__field--toggle clip-properties__field--wide audio-editor-clip-stretch"
			data-clip-properties-field="stretch-tempo" disabled={disabled || !single}
			onClick={() => { if (single) run(() => actions.toggleStretchToTempo(clip.id)); }}>
			<span className="clip-properties__value">{copy.stretchToTempo}</span><span className="clip-properties__switch" aria-hidden="true" />
		</button></div>,
		sections: <><div className="clip-properties__group" data-group="normalize">
			<h3 className="clip-properties__section">{copy.clipNormalize}</h3>
			<div className="clip-properties__row">
				<Button variant="secondary" data-clip-properties-action="normalize-peak" title={copy.normalizePeak} disabled={disabled || !single}
					onClick={() => { if (single) run(() => actions.normalizePeak(clip.id)); }}>{copy.clipNormalizePeakTarget}</Button>
				<Button variant="secondary" data-clip-properties-action="normalize-loudness" title={copy.normalizeLufs} disabled={disabled || !single}
					onClick={() => { if (single) run(() => actions.normalizeLoudness(clip.id)); }}>{copy.clipNormalizeLoudnessTarget}</Button>
			</div>
		</div>{single && source && <ClipAudioFormatSection key={`${clip.id}:${source.id}:${source.sampleRate}:${source.sampleFormat}`}
			source={source} copy={copy} disabled={disabled} onReinterpret={request => run(() => actions.reinterpret(clip.id, request))}
			onResample={request => run(() => actions.resample(clip.id, request))} />}</>,
	};
}
