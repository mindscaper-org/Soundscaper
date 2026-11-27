// SPDX-License-Identifier: AGPL-3.0-only

#include "project_archive.h"
#include "session_state.h"

#include <set>
#include <stdexcept>

namespace soundscaper::tracktion_backend
{
namespace
{
bool isProjectMediaPath(const juce::String& path)
{
	return path.startsWith("media/") && path.length() == 42 && path.endsWith(".wav")
	    && path.substring(6, 38).containsOnly("0123456789abcdef");
}

std::string describeLimit(std::int64_t bytes)
{
	constexpr auto mebibyte = 1024 * 1024;
	if (bytes % mebibyte == 0) return std::to_string(bytes / mebibyte) + " MiB";
	return std::to_string(bytes) + " bytes";
}
}

void extractProjectArchive(const juce::File& archive, const juce::File& directory, ProjectArchiveLimits limits)
{
	if (!archive.existsAsFile() || archive.isSymbolicLink() || archive.getSize() == 0
	    || directory.exists() || directory.isSymbolicLink() || limits.expandedBytes <= 0 || limits.zipBytes <= 0)
		throw std::invalid_argument("The Tracktion archive or its staging directory is invalid");
	if (archive.getSize() > limits.zipBytes)
		throw std::invalid_argument("The Tracktion ZIP file exceeds " + describeLimit(limits.zipBytes));

	juce::ZipFile zip(archive);
	std::set<juce::String> names;
	auto remaining = limits.expandedBytes;
	for (int index = 0; index < zip.getNumEntries(); ++index)
	{
		const auto* entry = zip.getEntry(index);
		if (!entry || entry->isSymbolicLink || entry->uncompressedSize < 0 || entry->uncompressedSize > remaining)
			throw std::invalid_argument("The Tracktion archive exceeds its expansion bound or contains an invalid entry");
		const auto& name = entry->filename;
		if (name != "project.tracktionedit" && name != "project_info.json" && !isProjectMediaPath(name))
			throw std::invalid_argument("The Tracktion archive contains an unsupported project path");
		if (!names.insert(name).second)
			throw std::invalid_argument("The Tracktion archive contains duplicate project paths");
		remaining -= entry->uncompressedSize;
	}
	if (!names.contains("project.tracktionedit"))
		throw std::invalid_argument("The Tracktion archive is missing its Edit file");
	if (directory.createDirectory().failed())
		throw std::runtime_error("Cannot create a Tracktion archive staging directory");

	try
	{
		if (directory.getChildFile("media").createDirectory().failed())
			throw std::runtime_error("Cannot create the Tracktion archive media directory");
		for (int index = 0; index < zip.getNumEntries(); ++index)
		{
			const auto& entry = *zip.getEntry(index);
			std::unique_ptr<juce::InputStream> input(zip.createStreamForEntry(entry));
			const auto target = directory.getChildFile(entry.filename);
			auto output = target.createOutputStream();
			if (!input || !output)
				throw std::runtime_error("Cannot extract a Tracktion archive entry");
			const auto written = output->writeFromInputStream(*input, entry.uncompressedSize);
			char trailing = 0;
			if (written != entry.uncompressedSize || input->read(&trailing, 1) != 0)
				throw std::invalid_argument("The Tracktion archive entry does not match its declared size");
			output->flush();
			if (output->getStatus().failed())
				throw std::runtime_error("Cannot write a Tracktion archive entry");
		}
	}
	catch (...)
	{
		directory.deleteRecursively();
		throw;
	}
}

void Session::archive(Revision expected, const juce::File& output, ProjectArchiveLimits limits)
{
	auto& s = *state;
	s.checkRevision(expected);
	if (output.exists() || output.isSymbolicLink() || !output.hasFileExtension("zip"))
		throw std::invalid_argument("Archive requires a new ZIP file");

	auto remaining = limits.expandedBytes;
	const auto accountEntry = [&](std::int64_t bytes) {
		if (bytes < 0 || bytes > remaining)
			throw std::invalid_argument("The project exceeds the ZIP archive's " + describeLimit(limits.expandedBytes) + " uncompressed limit");
		remaining -= bytes;
	};
	const juce::TemporaryFile snapshot(".tracktionedit");
	te::EditFileOperations files(*s.edit);
	if (!files.writeToFile(snapshot.getFile(), false))
		throw std::runtime_error("Cannot stage the Tracktion archive Edit");
	static constexpr char archiveInfo[] = "{\"archive_type\":1}";
	accountEntry(snapshot.getFile().getSize());
	accountEntry(sizeof(archiveInfo) - 1);
	juce::ZipFile::Builder archive;
	archive.addFile(snapshot.getFile(), 1, "project.tracktionedit");
	archive.addEntry(std::make_unique<juce::MemoryInputStream>(archiveInfo, sizeof(archiveInfo) - 1, false), 1,
	                 "project_info.json", juce::Time::getCurrentTime());

	// The Edit already refers to owned relative media. Pack those references
	// directly and exclude caches, files left by undo, and unrelated contents.
	std::set<juce::File> sources;
	for (auto* track : te::getAudioTracks(*s.edit))
		for (auto* clip : track->getClips())
			sources.insert(clip->getSourceFileReference().getFile());
	for (const auto& file : sources)
	{
		const auto path = juce::String(mediaDirectory) + "/" + file.getFileName();
		if (file == juce::File{} || ownedMediaFile(s.directory, path) != file)
			throw std::invalid_argument("The Tracktion project media is unavailable");
		accountEntry(file.getSize());
		archive.addFile(file, 1, path);
	}

	juce::TemporaryFile staging(output);
	{
		auto stream = staging.getFile().createOutputStream();
		if (!stream || !archive.writeToStream(*stream, nullptr))
			throw std::runtime_error("Cannot write the Tracktion archive");
		stream->flush();
		if (stream->getStatus().failed())
			throw std::runtime_error("Cannot finish the Tracktion archive");
	}
	if (staging.getFile().getSize() > limits.zipBytes)
		throw std::invalid_argument("The project exceeds the ZIP file size limit of " + describeLimit(limits.zipBytes));
	if (!staging.overwriteTargetFileWithTemporary())
		throw std::runtime_error("Cannot publish the Tracktion archive");
}
}
