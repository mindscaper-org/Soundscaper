/* SPDX-License-Identifier: AGPL-3.0-only */
export type UploadValidationReason = 'clipUnavailable' | 'audioUnavailable' | 'conversionRequired' | 'invalidClip' | 'cancelBeforeRemoving' | 'notReady' | 'preparationFailed' | 'transferFailed' | 'unsupportedFile' | 'emptyFile' | 'fileTooLarge' | 'namedFileRequired' | 'preparedFormat' | 'selectFiles' | 'queueFull' | 'notConnected' | 'queueClosed' | 'invalidState' | 'settingsRequired' | 'rightsRequired' | 'metadataInvalid' | 'attributionTooLong' | 'sourceRestricted' | 'tagsArray' | 'tagsInvalid' | 'tagsDuplicate' | 'tagsTooFew' | 'tagsTooMany' | 'tagsTooLong' | 'categoryInvalid' | 'licenseInvalid' | 'licenseIncompatible' | 'fieldUnsupported' | 'fieldRequired' | 'fieldTooLong';
export interface UploadValidationFailure {
	readonly reason: UploadValidationReason;
	readonly parameters: Readonly<Record<string, string | number>>;
}
const failures = new WeakMap<Error, UploadValidationFailure>();
/** Keep diagnostic text and Error subclasses intact while exposing stable presentation data. */
export function withUploadValidationFailure<Failure extends Error>(error: Failure, reason: UploadValidationReason, parameters: UploadValidationFailure['parameters'] = {}): Failure {
	failures.set(error, Object.freeze({ reason, parameters: Object.freeze({ ...parameters }) }));
	return error;
}
export function uploadValidationFailure(error: unknown): UploadValidationFailure | undefined {
	return error instanceof Error ? failures.get(error) : undefined;
}
