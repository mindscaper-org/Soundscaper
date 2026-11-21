/* SPDX-License-Identifier: AGPL-3.0-only */

interface Props {
	readonly copy: Readonly<{ addMarker: string }>;
	readonly blocked: boolean;
	readonly createAnnotation: (kind: 'auto', focusCreated: (id: string) => unknown) => unknown;
	readonly focusCreated: (id: string) => unknown;
}

export function TimelineAnnotationLaneActions({ copy, blocked, createAnnotation, focusCreated }: Props) {
	return <div className="audio-editor-timeline-annotation-lane-actions"
		data-timeline-annotation-interactive data-timeline-annotation-create-actions>
		<button type="button" disabled={blocked} onClick={() => createAnnotation('auto', focusCreated)}>{copy.addMarker}</button>
	</div>;
}
