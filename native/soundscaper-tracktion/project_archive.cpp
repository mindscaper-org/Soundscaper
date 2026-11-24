// SPDX-License-Identifier: AGPL-3.0-only

#include "project_archive.h"

#include <juce_core/juce_core.h>

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
}

void extractProjectArchive(const juce::File& archive, const juce::File& directory, std::int64_t expandedByteLimit)
{
	if (!archive.existsAsFile() || archive.isSymbolicLink() || archive.getSize() == 0
	    || directory.exists() || directory.isSymbolicLink() || expandedByteLimit <= 0)
		throw std::invalid_argument("The Tracktion archive or its staging directory is invalid");

	juce::ZipFile zip(archive);
	std::set<juce::String> names;
	auto remaining = expandedByteLimit;
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
}
