// SPDX-License-Identifier: AGPL-3.0-only
// Private fixture driver, never a shipping filesystem/process authority.
#include "raw_engine.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <iomanip>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#include <cstdio>
#include <fcntl.h>
#include <io.h>
#endif

namespace raw = lightscaper::raw::current_v1;
namespace {
constexpr std::size_t max_input = 64u * 1024u * 1024u;
struct Input {
 std::vector<std::uint8_t> bytes;
 ~Input() { volatile std::uint8_t* cursor=bytes.data(); for(std::size_t i=0;i<bytes.size();++i)cursor[i]=0; }
};
const char* format(raw::Format value) {
 switch(value) {
  case raw::Format::none: return "none";
  case raw::Format::rgba8: return "rgba8";
  case raw::Format::rgba16le: return "rgba16le";
  case raw::Format::rgba32fle: return "rgba32fle";
  case raw::Format::jpeg: return "jpeg";
  case raw::Format::bitmap8: return "bitmap8";
  case raw::Format::bitmap16le: return "bitmap16le";
 }
 throw std::runtime_error("Native engine returned an unknown format.");
}
}
int main(int argc,char** argv) {
 try {
#ifdef _WIN32
  if(_setmode(_fileno(stdin),_O_BINARY)<0||_setmode(_fileno(stdout),_O_BINARY)<0)throw std::runtime_error("Native fixture binary stdio failed.");
#endif
  if(argc<2||argc>3)throw std::runtime_error("Private native fixture requires one fixed operation and optional tier.");
  const std::string operation=argv[1];
  const bool prepare=operation=="preview-neutral"||operation=="preview-headroom"||operation=="preview-recovery";
  raw::Mode mode;
  if(operation=="neutral"||operation=="preview-neutral")mode=raw::Mode::neutral;
  else if(operation=="linear-headroom"||operation=="preview-headroom")mode=raw::Mode::linear_headroom;
  else if(operation=="highlight-recovery"||operation=="preview-recovery")mode=raw::Mode::highlight_recovery;
  else if(operation=="embedded")mode=raw::Mode::embedded;
  else throw std::runtime_error("Unknown fixed native fixture operation.");
  if(prepare!=(argc==3))throw std::runtime_error("Private preview fixture requires exactly one fixed tier.");
  raw::Tier tier=raw::Tier::thumbnail;
  if(prepare){const std::string choice=argv[2];if(choice=="fit-screen")tier=raw::Tier::fit_screen;else if(choice!="thumbnail")throw std::runtime_error("Unknown fixed preview tier.");}
  Input input;std::array<char,65536> chunk{};
  while(std::cin){std::cin.read(chunk.data(),static_cast<std::streamsize>(chunk.size()));const auto count=std::cin.gcount();
   if(count<0||static_cast<std::size_t>(count)>max_input-input.bytes.size())throw std::runtime_error("Native fixture input exceeds its fixed bound.");
   input.bytes.insert(input.bytes.end(),chunk.data(),chunk.data()+count);}
  if(!std::cin.eof())throw std::runtime_error("Native fixture input did not complete.");
  auto result=raw::decode(mode,input.bytes.data(),input.bytes.size());
  if(prepare)result=raw::preview(result,tier);
  if(result.bytes.size()>256u*1024u*1024u||!std::isfinite(result.exposure_scale))throw std::runtime_error("Native fixture result exceeds its scalar bounds.");
  std::cout<<"LRAW1\n{\"engine\":\"lightscaper-libraw-native\",\"engineVersion\":1,\"upstream\":\"0.22.2\",\"profile\":\""<<operation
   <<"\",\"recipe\":"<<(prepare?"\"lightscaper.native-original-preview.rgba8-nearest/v1\"":"null")<<",\"format\":\""<<format(result.format)<<"\",\"width\":"<<result.width<<",\"height\":"<<result.height
   <<",\"channels\":"<<result.channels<<",\"bits\":"<<result.bits<<",\"rawFlip\":"<<result.raw_flip
   <<",\"exposureScale\":"<<std::setprecision(17)<<result.exposure_scale<<",\"byteLength\":"<<result.bytes.size()<<"}\n";
  for(std::size_t offset=0;offset<result.bytes.size();offset+=1024u*1024u){const auto count=std::min<std::size_t>(1024u*1024u,result.bytes.size()-offset);
   std::cout.write(reinterpret_cast<const char*>(result.bytes.data()+offset),static_cast<std::streamsize>(count));if(!std::cout)throw std::runtime_error("Native fixture output failed.");}
  std::cout.flush();if(!std::cout)throw std::runtime_error("Native fixture output did not finish.");return 0;
 }catch(const std::exception& error){const std::string text=error.what();std::cerr<<text.substr(0,512)<<'\n';return 2;}
 catch(...){std::cerr<<"Native fixture failed.\n";return 3;}
}
