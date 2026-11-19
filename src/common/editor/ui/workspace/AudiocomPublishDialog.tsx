/* SPDX-License-Identifier: AGPL-3.0-only */
import { uploadErrorLabel } from '../upload-validation-presentation.ts';

import { useId, useState, type FormEvent } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';

import type { AudiocomUploadDraft, AudiocomUploadItem } from '../../controller/import/audiocom-panel-session.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import EditorControlLabel from '../EditorControlLabel.tsx';

interface AudiocomPublishDialogProps {
	readonly copy: Readonly<Record<string, string>>;
	readonly item: AudiocomUploadItem;
	readonly onClose: () => void;
	readonly onPublish: (id: string, draft: AudiocomUploadDraft) => Promise<void> | void;
}

const CATEGORIES = [
	['music', 'categoryMusic'], ['podcast', 'categoryPodcast'], ['voice-over', 'categoryVoiceOver'],
	['sound-design', 'categorySoundDesign'], ['cover', 'categoryCover'], ['beats', 'categoryBeats'],
	['audiobook', 'categoryAudiobook'], ['recording', 'categoryRecording'], ['other', 'categoryOther'],
] as const;
const LICENSES = [
	['none', 'licenseNone'], ['arr', 'licenseArr'], ['cc-0', 'licenseCc0'], ['cc-by', 'licenseCcBy'],
	['cc-by-sa', 'licenseCcBySa'], ['cc-by-nc', 'licenseCcByNc'], ['cc-by-nc-sa', 'licenseCcByNcSa'],
	['cc-by-nd', 'licenseCcByNd'], ['cc-by-nc-nd', 'licenseCcByNcNd'],
] as const;

export default function AudiocomPublishDialog({ copy, item, onClose, onPublish }: AudiocomPublishDialogProps) {
	const formId = useId();
	const visibilityNoteId = useId();
	const [title, setTitle] = useState(item.draft?.title ?? item.title);
	const [description, setDescription] = useState(item.draft?.description ?? '');
	const [category, setCategory] = useState<AudiocomUploadDraft['category']>(item.draft?.category ?? 'recording');
	const [license, setLicense] = useState<AudiocomUploadDraft['license']>(item.draft?.license ?? 'arr');
	const [visibility, setVisibility] = useState<AudiocomUploadDraft['visibility']>(item.draft?.visibility ?? 'unlisted');
	const [downloadable, setDownloadable] = useState(item.draft?.downloadable ?? false);
	const [rightsConfirmed, setRightsConfirmed] = useState(item.draft?.rightsConfirmed ?? false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<unknown>(null);
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (pending || !title.trim() || !rightsConfirmed) return;
		setPending(true);
		setError(null);
		void Promise.resolve().then(() => onPublish(item.id, {
			title: title.trim(), description, category, license, visibility, downloadable, rightsConfirmed,
		})).then(onClose).catch((reason: unknown) => {
			setPending(false);
			setError(reason);
		});
	};
	return <AudioEditorDialogShell title={copy.uploadHeading} width={560} initialFocus={'[name="title"]'}
		onClose={pending ? undefined : onClose} dataAttributes={{ 'data-audiocom-publish-dialog': 'true' }}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button variant="secondary" disabled={pending} onClick={onClose}>{copy.cancel}</Button>
			<Button type="submit" form={formId} variant="primary" disabled={pending || !title.trim() || !rightsConfirmed}>
				{pending ? copy.statusQueued : copy.publish}
			</Button>
		</>} />}>
		<form id={formId} className="kw-audio-editor__audiocom-publish-form" onSubmit={submit}>
			{error ? <p role="alert">{uploadErrorLabel(error, copy, copy.publishError)}</p> : null}
			<label><EditorControlLabel>{copy.title}</EditorControlLabel>
				<input name="title" value={title} required maxLength={200} disabled={pending}
					onChange={(event) => setTitle(event.currentTarget.value)} />
			</label>
			<label><EditorControlLabel>{copy.description}</EditorControlLabel>
				<textarea name="description" value={description} rows={4} maxLength={500} disabled={pending}
					onChange={(event) => setDescription(event.currentTarget.value)} />
			</label>
			<label><EditorControlLabel>{copy.category}</EditorControlLabel>
				<select name="category" value={category} disabled={pending}
					onChange={(event) => setCategory(event.currentTarget.value as AudiocomUploadDraft['category'])}>
					{CATEGORIES.map(([value, key]) => <option key={value} value={value}>{copy[key]}</option>)}
				</select>
			</label>
			<label><EditorControlLabel>{copy.license}</EditorControlLabel>
				<select name="license" value={license} disabled={pending}
					onChange={(event) => setLicense(event.currentTarget.value as AudiocomUploadDraft['license'])}>
					{LICENSES.map(([value, key]) => <option key={value} value={value}>{copy[key]}</option>)}
				</select>
			</label>
			<label><EditorControlLabel>{copy.visibility}</EditorControlLabel>
				<select name="visibility" value={visibility} disabled={pending} aria-describedby={visibilityNoteId}
					onChange={(event) => setVisibility(event.currentTarget.value as AudiocomUploadDraft['visibility'])}>
					<option value="unlisted">{copy.unlisted}</option>
					<option value="listed">{copy.listed}</option>
				</select>
				<small id={visibilityNoteId}>{copy.unlistedNotice}</small>
			</label>
			<label className="kw-audio-editor__audiocom-checkbox">
				<input name="downloadable" type="checkbox" checked={downloadable} disabled={pending}
					onChange={(event) => setDownloadable(event.currentTarget.checked)} />
				<EditorControlLabel>{copy.downloadable}</EditorControlLabel>
			</label>
			<label className="kw-audio-editor__audiocom-checkbox">
				<input name="rightsConfirmed" type="checkbox" checked={rightsConfirmed} required disabled={pending}
					onChange={(event) => setRightsConfirmed(event.currentTarget.checked)} />
				<EditorControlLabel>{copy.uploadRightsConsent}</EditorControlLabel>
			</label>
		</form>
	</AudioEditorDialogShell>;
}
