// SPDX-License-Identifier: AGPL-3.0-only

#pragma once

#include <juce_core/juce_core.h>

#include <cstddef>
#include <cstdint>

namespace soundscaper::tracktion_backend
{
class StagedFileOutput final : public juce::OutputStream
{
public:
	StagedFileOutput(const juce::File& file, juce::int64 sizeLimit)
		: output(file), sizeLimit(sizeLimit), healthy(output.openedOk() && output.getPosition() == 0) {}

	bool ready() const { return healthy; }
	bool exceededSizeLimit() const { return exceededLimit; }
	void flush() override { output.flush(); }
	juce::int64 getPosition() override { return output.getPosition(); }
	bool setPosition(juce::int64) override
	{
		healthy = false;
		return false;
	}

	bool write(const void* data, std::size_t bytes) override
	{
		if (!healthy) return false;
		const auto remaining = sizeLimit - getPosition();
		exceededLimit = remaining < 0 || bytes > static_cast<std::uint64_t>(remaining);
		healthy = !exceededLimit && output.write(data, bytes);
		return healthy;
	}

	bool complete()
	{
		flush();
		// A short final flush can leave the stream status successful.
		return healthy && output.getStatus().wasOk() && getPosition() == output.getFile().getSize();
	}

private:
	juce::FileOutputStream output;
	const juce::int64 sizeLimit;
	bool healthy;
	bool exceededLimit = false;
};
}
