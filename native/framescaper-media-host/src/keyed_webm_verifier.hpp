/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once

#include "media_plan.hpp"
#include "selected_v20_frame_executor.hpp"

namespace framescaper::media {

/** Record each submitted alpha plane and independently decode the completed WebM. */
class keyed_webm_verifier final {
public:
	keyed_webm_verifier(const admitted_media_plan& plan, std::filesystem::path scratch);
	void capture(const selected_v20_output_frame& frame);
	void verify(const std::filesystem::path& output, const std::string& sha256) const;
private:
	const admitted_media_plan& plan_;
	std::filesystem::path scratch_;
	std::vector<std::string> alpha_;
};

} // namespace framescaper::media
