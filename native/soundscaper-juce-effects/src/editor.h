/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once
#include "processor.h"
#include <juce_gui_extra/juce_gui_extra.h>

namespace soundscaper::effects {
class Editor final : public juce::DocumentWindow, private juce::Timer {
public:
	explicit Editor(Processor &);
	void closeButtonPressed() override { setVisible(false); }
private:
	void timerCallback() override;
	Processor &processor;
	juce::Component panel;
	std::array<juce::Slider, maximumParameters> sliders;
	std::array<juce::ComboBox, maximumParameters> choices;
	std::array<juce::Label, maximumParameters> labels;
	juce::TextButton load{"Load impulse response..."};
	juce::Label status;
	std::unique_ptr<juce::FileChooser> chooser;
};
}
