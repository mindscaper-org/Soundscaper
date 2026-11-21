/* SPDX-License-Identifier: AGPL-3.0-only */

import EditorHelpTooltip from './EditorHelpTooltip.tsx';
import PreferenceCheckbox from './EditorPreferenceCheckbox.tsx';
import { LabeledDropdown } from './inspector/inspector-controls.jsx';
import { exportDialogEmbeddedChapterModel, exportDialogSupportsEmbeddedChapters } from './export-dialog-embedded-chapters.ts';

interface ExportEmbeddedChaptersFieldProps {
	readonly copy: Readonly<{
		embedLabelChapters: string;
		embedLabelChaptersHint: string;
		embedLabelChaptersNoLabels: string;
		embeddedChapterTrack: string;
		embeddedChapterAllLabelTracks: string;
		panelMarkers: string;
		labels: string;
		helpMenu: string;
	}>;
	readonly settings: Readonly<Record<string, unknown>>;
	readonly project: unknown;
	readonly exporting: boolean;
	readonly onChange: (name: string, value: boolean | string) => void;
}

/** The menu-opened export dialog is the opt-in entry point for chapter metadata. */
export default function ExportEmbeddedChaptersField({
	copy, settings, project, exporting, onChange,
}: ExportEmbeddedChaptersFieldProps) {
	if (!exportDialogSupportsEmbeddedChapters(settings)) return null;
	const { tracks, track, available, checked } = exportDialogEmbeddedChapterModel(project, settings);
	return <>
		<div className="audio-editor-export-check" data-export-field="embedLabelChapters">
			<span aria-hidden="true" />
			<span className="audio-editor-help-label">
				<PreferenceCheckbox
					label={copy.embedLabelChapters}
					checked={checked}
					disabled={exporting || !available}
					onChange={(enabled) => onChange('embedChapters', enabled)}
				/>
				<EditorHelpTooltip subject={copy.embedLabelChapters} description={copy.embedLabelChaptersHint} helpLabel={copy.helpMenu} hook="embedLabelChapters" />
			</span>
		</div>
		{tracks.length > 1 && <div className="audio-editor-export-chapter-track">
			<LabeledDropdown label={copy.embeddedChapterTrack} hook="embeddedChapterTrack" value={track}
				onChange={(value: string) => onChange('embeddedChapterTrack', value)} disabled={exporting}
				options={tracks.map(({ value, name }) => ({ value, label: value === 'markers' ? copy.panelMarkers
					: value === 'all-label-tracks' ? copy.embeddedChapterAllLabelTracks : name || copy.labels }))} />
		</div>}
		{!available && <p className="audio-editor-panel-hint" data-export-chapters-hint>{copy.embedLabelChaptersNoLabels}</p>}
	</>;
}
