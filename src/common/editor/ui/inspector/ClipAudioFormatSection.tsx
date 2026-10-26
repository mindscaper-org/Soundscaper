/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { SampleRateGlyph } from '@soundscaper/design-system/ClipPropertiesPanel/clip-properties-glyphs';
import { parseClipResampleRate } from './clip-resample-rate.ts';

export interface ClipAudioFormatRequest {
	readonly sampleRate: number;
	readonly sampleFormat?: 'int16' | 'int24' | 'float32';
}

interface Props {
	readonly source: { readonly sampleRate?: number; readonly sampleFormat?: string };
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled: boolean;
	readonly onReinterpret: (request: ClipAudioFormatRequest) => unknown;
	readonly onResample: (request: ClipAudioFormatRequest) => unknown;
}

/** Format fields are drafts: only an explicit conversion button changes media. */
export default function ClipAudioFormatSection({ source, copy, disabled, onReinterpret, onResample }: Props) {
	const [rate, setRate] = useState(String(source.sampleRate ?? ''));
	const retainedFormat = source.sampleFormat === 'int32' || source.sampleFormat === 'float64';
	const initialFormat = retainedFormat ? 'source' : source.sampleFormat === 'int16' || source.sampleFormat === 'int24' ? source.sampleFormat : 'float32';
	const [sampleFormat, setSampleFormat] = useState<NonNullable<ClipAudioFormatRequest['sampleFormat']> | 'source'>(initialFormat);
	const sampleRate = parseClipResampleRate(rate);
	const unchanged = sampleRate === source.sampleRate && sampleFormat === initialFormat;
	const blocked = disabled || sampleRate === null || unchanged;
	const apply = (action: Props['onResample']) => {
		if (!blocked && sampleRate !== null) action({ sampleRate, ...(sampleFormat === 'source' ? {} : { sampleFormat }) });
	};
	return <div className="clip-properties__group" data-group="format" data-clip-source-sample-rate={source.sampleRate}>
		<h3 className="clip-properties__section">{copy.format}</h3>
		<div className="clip-properties__row">
			<label className="clip-properties__field" data-clip-properties-field="format-rate" data-tooltip={copy.sampleRateHz}>
				<span className="clip-properties__glyph-cell"><SampleRateGlyph /></span>
				<input type="number" className="audio-editor-clip-format__rate" aria-label={copy.sampleRateHz}
					value={rate} min={8000} max={384000} step={1000} disabled={disabled} aria-invalid={sampleRate === null || undefined}
					onChange={event => setRate(event.currentTarget.value)} />
			</label>
			<label className="clip-properties__field" data-clip-properties-field="format-depth" data-tooltip={copy.bitDepth}>
				<select className="audio-editor-clip-format__depth" aria-label={copy.bitDepth} disabled={disabled} value={sampleFormat}
					onChange={event => { const value = event.currentTarget.value; if (value === 'source' || value === 'int16' || value === 'int24' || value === 'float32') setSampleFormat(value); }}>
					{retainedFormat && <option value="source">{source.sampleFormat === 'int32' ? copy.sampleFormatPcm.replace('{bits}', '32') : copy.clipSampleFormatFloat64}</option>}
					<option value="int16">{copy.sampleFormatPcm.replace('{bits}', '16')}</option>
					<option value="int24">{copy.sampleFormatPcm.replace('{bits}', '24')}</option>
					<option value="float32">{copy.sampleFormatFloat32}</option>
				</select>
			</label>
		</div>
		{sampleRate === null && <p className="audio-editor-clip-format__help" role="alert">{copy.invalidClipSampleRate}</p>}
		<div className="clip-properties__row">
			<Button variant="secondary" data-clip-properties-action="reinterpret" disabled={blocked} title={copy.clipReinterpretDescription}
				onClick={() => apply(onReinterpret)}>{copy.clipReinterpret}</Button>
			<Button variant="secondary" data-clip-properties-action="resample" disabled={blocked} title={copy.clipResampleDescription}
				onClick={() => apply(onResample)}>{copy.resample}</Button>
		</div>
	</div>;
}
