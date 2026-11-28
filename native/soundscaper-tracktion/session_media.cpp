// SPDX-License-Identifier: AGPL-3.0-only

#include "session_state.h"

#include <map>
#include <set>

namespace soundscaper::tracktion_backend
{
juce::File ownedMediaFile(const juce::File& directory, const juce::String& reference)
{
	const auto relative = reference.replaceCharacter('\\', '/');
	if (!relative.startsWith("media/"))
		return {};
	const auto name = relative.substring(6);
	if (name.length() != 36 || !name.endsWith(".wav") || !name.dropLastCharacters(4).containsOnly("0123456789abcdef"))
		return {};
	const auto media = directory.getChildFile(mediaDirectory);
	const auto file = media.getChildFile(name);
	if (media.isSymbolicLink() || file.isSymbolicLink() || !file.existsAsFile())
		return {};
	return file;
}

namespace
{
struct EditMediaLoad
{
	const juce::File& directory;
	std::map<juce::String, juce::File> paths;
};

// Only synchronous construction on this thread can reuse these paths.
thread_local EditMediaLoad* loadingMedia = nullptr;

juce::File resolveEditMedia(const juce::File& directory, const juce::String& reference)
{
	if (!loadingMedia || loadingMedia->directory != directory)
		return ownedMediaFile(directory, reference);
	const auto [entry, inserted] = loadingMedia->paths.try_emplace(reference);
	if (inserted) entry->second = ownedMediaFile(directory, reference);
	return entry->second;
}
}

std::unique_ptr<te::Edit> Session::State::makeEdit(juce::ValueTree tree, te::Edit::EditRole role)
{
	EditMediaLoad load{directory, {}};
	const juce::ScopedValueSetter scope(loadingMedia, &load);
	return te::Edit::createEdit({
		.engine = engine,
		.editState = std::move(tree),
		.editProjectItemID = te::ProjectItemID::createNewID(te::ProjectID{}),
		.role = role,
		.editFileRetriever = [file = editFile] { return file; },
		.filePathResolver = [folder = directory](const juce::String& reference)
		{
			return resolveEditMedia(folder, reference);
		},
		.defaultMasterVolumedB = 0.0f,
	});
}

void requireEditMedia(const te::Edit& edit, const char* failure)
{
	std::set<juce::String> checked;
	for (auto* track : te::getAudioTracks(edit))
		for (auto* clip : track->getClips())
		{
			if (dynamic_cast<te::WaveAudioClip*>(clip) == nullptr) throw std::invalid_argument(failure);
			const auto& source = clip->getSourceFileReference();
			if (checked.insert(source.source.get()).second && !source.getFile().existsAsFile())
				throw std::invalid_argument(failure);
		}
}
}
