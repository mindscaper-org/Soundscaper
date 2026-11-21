/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { AUDIO_EDITOR_TIMELINE_ANNOTATION_COLORS } from '../../timeline-annotation.ts';
import AudioEditorTimeCodeInput from '../AudioEditorTimeCodeInput.tsx';
import EditorControlLabel from '../EditorControlLabel.tsx';
import { editorProjectEditSessionKey } from '../project-edit-session-key.ts';
import { useCommittedCallbacks } from '../useCommittedCallbacks.ts';
import { isContextMenuKey } from './context-menu-keyboard.ts';
import { TimelineMarkerContextMenu } from './TimelineMarkerContextMenu.tsx';
import { useTimelineAnnotationInteractions } from './useTimelineAnnotationInteractions.js';

export function TimelineAnnotationPanel(props) {
	return <TimelineAnnotationPanelSession key={editorProjectEditSessionKey(props.controller, props.project?.id)} {...props} />;
}

function TimelineAnnotationPanelSession({
	controller, project, annotations, selectedAnnotationId, copy, locale, sampleRate, blocked, run, createAnnotation,
	onExportRange, canEditAudio = false,
}) {
	const addMarkerRef = useRef(null);
	const renameRef = useRef(null);
	const [expandedId, setExpandedId] = useState(null);
	const {
		actions, beginRename, convert, draftName, editingId, focusCreated,
		handleKeyDown, handleRenameBlur, handleRenameKeyDown, itemRefs, model, moveTo,
		remove, resizeTo, select, setDraftName, status, markerMenu, openMarkerMenu, closeMarkerMenu,
	} = useTimelineAnnotationInteractions({
		controller, project, annotations, selectedAnnotationId, copy, locale, sampleRate, blocked, run, createAnnotation,
		focusFallbackRef: addMarkerRef,
	});

	useEffect(() => {
		if (!editingId) return;
		renameRef.current?.focus();
		renameRef.current?.select();
	}, [editingId]);

	const edit = (annotation) => {
		if (blocked) return;
		setExpandedId(annotation.id);
		beginRename(annotation);
	};
	const rowActions = useCommittedCallbacks({
		select, edit, openMarkerMenu, handleKeyDown, setDraftName, handleRenameBlur, handleRenameKeyDown,
		focus: (id) => {
			setExpandedId(current => current === id ? current : null);
			run(() => actions.focus(id));
		},
		setColor: (id, color) => run(() => actions.setColor([id], color)),
		convert, moveTo, resizeTo,
	});
	const menuAnnotation = markerMenu ? model.rows.find(row => row.id === markerMenu.id)?.annotation : null;

	return <section className="audio-editor-timeline-annotation-panel" data-timeline-annotation-panel aria-label={copy.panelMarkers}
		onKeyDown={(event) => { if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation(); }}>
		<div className="kw-audio-editor__panel-actions-inline audio-editor-timeline-annotation-panel__actions">
			<Button ref={addMarkerRef} variant="secondary" disabled={blocked} onClick={() => createAnnotation('auto', focusCreated)}>
				{copy.newMarker}
			</Button>
		</div>
		{model.rows.length ? <ul className="kw-audio-editor__panel-list audio-editor-timeline-annotation-list" aria-label={copy.timelineAnnotationList}>
			{model.rows.map((row, index) => <TimelineAnnotationRow key={row.id} row={row} index={index}
				expanded={expandedId === row.id} editing={editingId === row.id} draftName={editingId === row.id ? draftName : null}
				copy={copy} blocked={blocked} sampleRate={sampleRate} itemRefs={itemRefs} renameRef={renameRef} {...rowActions} />)}
		</ul> : <p className="kw-audio-editor__panel-empty">{copy.noTimelineAnnotations}</p>}
		<span className="kw-audio-editor-sr-only" role="status" aria-live="polite">{status}</span>
		{menuAnnotation && <TimelineMarkerContextMenu position={markerMenu} copy={copy} blocked={blocked}
			range={menuAnnotation.kind === 'region'} canEditAudio={canEditAudio}
			onEdit={() => edit(menuAnnotation)} onDelete={() => remove(menuAnnotation, undefined, true)}
			onExport={onExportRange && (() => onExportRange(menuAnnotation))}
			onAudioEdit={(action) => run(() => controller.actions.edit[action](menuAnnotation.id))}
			onClose={closeMarkerMenu} />}
	</section>;
}

const TimelineAnnotationRow = React.memo(function TimelineAnnotationRow({
	row, index, expanded, editing, draftName, copy, blocked, sampleRate, itemRefs, renameRef,
	select, edit, focus, setColor, openMarkerMenu, handleKeyDown, setDraftName, handleRenameBlur,
	handleRenameKeyDown, convert, moveTo, resizeTo,
}) {
	const annotation = row.annotation;
	const editorId = React.useId();
	return <li data-annotation-color={annotation.color} data-selected={row.selected ? 'true' : 'false'}>
		<button
			ref={(node) => node ? itemRefs.current.set(row.id, node) : itemRefs.current.delete(row.id)}
			type="button"
			className="audio-editor-timeline-annotation-list__item"
			data-timeline-annotation data-annotation-id={row.id}
			aria-pressed={row.selected} aria-expanded={expanded} aria-controls={expanded ? editorId : undefined}
			aria-disabled={blocked}
			onClick={(event) => select(event, annotation)}
			onDoubleClick={() => edit(annotation)}
			onFocus={() => focus(row.id)}
			onContextMenu={(event) => openMarkerMenu(event, annotation)}
			onKeyDown={(event) => {
				if (isContextMenuKey(event)) {
					openMarkerMenu(event, annotation, true);
				} else if (event.key === 'Enter' || event.key === 'F2') {
					event.preventDefault();
					event.stopPropagation();
					edit(annotation);
				} else handleKeyDown(event, row, index);
			}}
		>
			<span className="audio-editor-timeline-annotation-list__swatch" aria-hidden="true" />
			<span>{annotation.name || copy.unnamedTimelineAnnotation}</span>
			<small>{annotation.kind === 'marker' ? copy.timelineMarker : copy.timelineRegion}</small>
			<small>{row.timingLabel}</small>
		</button>
		{expanded && <div id={editorId} className="audio-editor-timeline-annotation-list__editor" role="group" aria-label={copy.editMarker}>
			<label className="audio-editor-field"><EditorControlLabel>{copy.annotationName}</EditorControlLabel><input
				ref={renameRef} disabled={blocked} value={editing ? draftName : annotation.name}
				onFocus={() => { if (!editing) edit(annotation); }}
				onChange={(event) => setDraftName(event.target.value)}
				onBlur={() => handleRenameBlur(annotation)}
				onKeyDown={handleRenameKeyDown}
			/></label>
			<label className="audio-editor-field"><EditorControlLabel>{copy.annotationColor}</EditorControlLabel>
				<select disabled={blocked} value={annotation.color} onChange={(event) => setColor(row.id, event.target.value)}>
					{AUDIO_EDITOR_TIMELINE_ANNOTATION_COLORS.map((color) => <option key={color} value={color}>{colorLabel(copy, color)}</option>)}
				</select>
			</label>
			<label className="audio-editor-field"><EditorControlLabel>{copy.annotationKind}</EditorControlLabel>
				<select disabled={blocked} value={annotation.kind} onChange={(event) => convert(annotation, { kind: event.target.value, anchor: annotation.anchor })}>
					<option value="marker">{copy.timelineMarker}</option><option value="region">{copy.timelineRegion}</option>
				</select>
			</label>
			<label className="audio-editor-field"><EditorControlLabel>{copy.annotationAnchor}</EditorControlLabel>
				<select disabled={blocked} value={annotation.anchor} onChange={(event) => convert(annotation, { kind: annotation.kind, anchor: event.target.value })}>
					<option value="sample">{copy.sampleAnchor}</option><option value="musical">{copy.musicalAnchor}</option>
				</select>
			</label>
			<TimelineAnnotationFrameField
				disabled={blocked} sampleRate={sampleRate} value={annotation.timelineStartFrame} minimum={0}
				maximum={annotation.kind === 'region' ? annotation.timelineEndFrame - 1 : Number.MAX_SAFE_INTEGER}
				label={annotation.kind === 'region' ? copy.annotationStartFrame : copy.annotationPosition}
				onCommit={(frame) => annotation.kind === 'region' ? resizeTo(annotation, 'start', frame) : moveTo(annotation, frame)}
			/>
			{annotation.kind === 'region' && <TimelineAnnotationFrameField
				disabled={blocked} sampleRate={sampleRate} value={annotation.timelineEndFrame}
				minimum={annotation.timelineStartFrame + 1} maximum={Number.MAX_SAFE_INTEGER}
				label={copy.annotationEndFrame} onCommit={(frame) => resizeTo(annotation, 'end', frame)}
			/>}
		</div>}
	</li>;
});

function TimelineAnnotationFrameField({ disabled, value, minimum, maximum, label, sampleRate, onCommit }) {
	return <label className="audio-editor-field audio-editor-timeline-annotation-list__time">
		<EditorControlLabel>{label}</EditorControlLabel>
		<AudioEditorTimeCodeInput label={label} value={value} unit="samples" rate={sampleRate} format="hh:mm:ss+milliseconds"
			variant="light" showFormatSelector={false} disabled={disabled} minimum={minimum} maximum={maximum} onCommit={onCommit} />
	</label>;
}

function colorLabel(copy, color) {
	return copy[`annotationColor${color[0].toUpperCase()}${color.slice(1)}`] || color;
}
