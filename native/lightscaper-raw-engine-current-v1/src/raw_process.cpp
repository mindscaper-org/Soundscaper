/* SPDX-License-Identifier: AGPL-3.0-only */
#include "raw_engine.hpp"
#include "raw_process_contract.hpp"
#include "sha256.hpp"
#ifdef LIGHTSCAPER_PHOTO_LINUX_BOOTSTRAP
extern "C" int lightscaper_photo_linux_bootstrap(void);
#endif
#ifdef LIGHTSCAPER_PHOTO_MACOS_BOOTSTRAP
#include "photo_macos_bootstrap.hpp"
#endif
#include <algorithm>
#include <array>
#include <bit>
#include <cstring>
#include <cstdio>
#include <iostream>
#include <limits>
#include <span>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
namespace {
namespace engine = lightscaper::raw::current_v1;
namespace wire = lightscaper::raw::process_current_v1;
using scape::native_common::sha256;
struct refusal { std::uint16_t code; std::uint8_t phase; const char* message; };
void require(bool valid, std::uint16_t code, std::uint8_t phase, const char* message) { if (!valid) throw refusal{code,phase,message}; }
void wipe(std::vector<std::uint8_t>& bytes) noexcept {
 auto* data = static_cast<volatile std::uint8_t*>(bytes.data()); for (std::size_t index=0;index<bytes.size();++index) data[index]=0;
 std::vector<std::uint8_t>().swap(bytes);
}
struct frame final {
 std::uint8_t operation=0; std::uint32_t id=0; std::vector<std::uint8_t> bytes;
 frame()=default; frame(const frame&)=delete; frame& operator=(const frame&)=delete;
 ~frame() { wipe(bytes); }
};
std::uint16_t u16(const std::uint8_t* p) { return static_cast<std::uint16_t>((std::uint16_t(p[0])<<8U)|p[1]); }
std::uint32_t u32(const std::uint8_t* p) { return (std::uint32_t(p[0])<<24U)|(std::uint32_t(p[1])<<16U)|(std::uint32_t(p[2])<<8U)|p[3]; }
std::uint64_t u64(const std::uint8_t* p) { std::uint64_t value=0; for(unsigned i=0;i<8;++i) value=(value<<8U)|p[i]; return value; }
void put(std::uint8_t* p,std::uint64_t value,unsigned count) { for(unsigned i=0;i<count;++i) p[count-1U-i]=static_cast<std::uint8_t>(value>>(i*8U)); }
std::string hex(const std::uint8_t* p,std::size_t count) { static constexpr char digits[]="0123456789abcdef"; std::string out(count*2,'0'); for(std::size_t i=0;i<count;++i) { out[i*2]=digits[p[i]>>4U];out[i*2+1]=digits[p[i]&15U]; }return out; }
std::array<std::uint8_t,32> unhex(const std::string& text) {
 require(text.size()==64,4,4,"Native output SHA is invalid."); std::array<std::uint8_t,32> out{};
 for(std::size_t i=0;i<32;++i) { const auto digit=[](char c)->unsigned { if(c>='0'&&c<='9')return unsigned(c-'0');if(c>='a'&&c<='f')return unsigned(c-'a'+10);throw refusal{4,4,"Native output SHA is invalid."};};out[i]=static_cast<std::uint8_t>((digit(text[i*2])<<4U)|digit(text[i*2+1])); }return out;
}
void read_exact(std::uint8_t* data,std::size_t length) {
 if(length) std::cin.read(reinterpret_cast<char*>(data),static_cast<std::streamsize>(length));
 require(!length || std::cin.gcount()==static_cast<std::streamsize>(length),1,1,"Native RAW input frame is truncated.");
}
void receive(frame& value,std::uint32_t& watermark) {
 std::array<std::uint8_t,16> header{};read_exact(header.data(),header.size());
 require(std::memcmp(header.data(),wire::magic,4)==0&&header[4]==wire::version&&u16(header.data()+6)==0,1,1,"Native RAW frame identity is invalid.");
 value.operation=header[5];value.id=u32(header.data()+8);const auto length=u32(header.data()+12);
 require(value.id>watermark&&value.id!=0,1,1,"Native RAW request watermark is invalid.");watermark=value.id;
 const auto cap=value.operation==3?wire::chunk_bytes+8:wire::control_bytes;
 require(length<=cap,1,1,"Native RAW frame length exceeds its fixed operation.");
 value.bytes.resize(length);read_exact(value.bytes.data(),length);
}
void send(std::uint8_t operation,std::uint32_t id,const std::uint8_t* data,std::size_t length) {
 require(length<=wire::chunk_bytes,4,5,"Native RAW output chunk exceeds its fixed bound.");
 std::array<std::uint8_t,16> header{};std::memcpy(header.data(),wire::magic,4);header[4]=wire::version;header[5]=operation;put(header.data()+8,id,4);put(header.data()+12,length,4);
 std::cout.write(reinterpret_cast<const char*>(header.data()),header.size());
 if(length) { std::cout.write(reinterpret_cast<const char*>(data),static_cast<std::streamsize>(length)); }
 std::cout.flush();
 if(!std::cout)throw std::runtime_error("Native RAW output pipe refused.");
}
std::uint8_t target() {
#if defined(__linux__) && defined(__x86_64__)
 return 1;
#elif defined(__linux__) && defined(__aarch64__)
 return 2;
#elif defined(__APPLE__) && defined(__aarch64__)
 return 3;
#elif defined(_WIN32) && (defined(_M_X64)||defined(__x86_64__))
 return 4;
#elif defined(_WIN32) && (defined(_M_ARM64)||defined(__aarch64__))
 return 5;
#else
#error The native RAW process requires a maintained authenticated target.
#endif
}
std::uint8_t format(engine::Format value) {
 switch(value) {case engine::Format::none:return 0;case engine::Format::rgba16le:return 1;case engine::Format::rgba32fle:return 2;case engine::Format::rgba8:return 3;case engine::Format::jpeg:return 4;case engine::Format::bitmap8:return 5;case engine::Format::bitmap16le:return 6;}
 throw refusal{4,4,"Native RAW result format is invalid."};
}
struct context final {
 std::vector<std::uint8_t> input;engine::Result output;sha256 input_hash;
 std::string expected_sha;std::uint64_t input_at=0,output_at=0;std::uint8_t mode=0,tier=0,state=0;
 ~context(){wipe(input);}
 void clear() noexcept {wipe(input);output.wipe();}
};
void init(const frame& request,context& state) {
 require(state.state==0&&request.bytes.size()==32,1,1,"Native RAW INIT is invalid.");
 std::vector<std::uint8_t> reply(request.bytes);const auto text=[&reply](std::string_view value){reply.push_back(static_cast<std::uint8_t>(value.size()));reply.insert(reply.end(),value.begin(),value.end());};
 text(engine::engine_id);const auto version_at=reply.size();reply.resize(version_at+2);put(reply.data()+version_at,engine::engine_version,2);text(engine::upstream_version);reply.push_back(target());
 const auto at=reply.size();reply.resize(at+12);put(reply.data()+at,engine::maximum_input_bytes,4);put(reply.data()+at+4,256U*1024U*1024U,4);put(reply.data()+at+8,wire::chunk_bytes,4);
 send(0x81,request.id,reply.data(),reply.size());state.state=1;
}
void begin(const frame& request,context& state) {
 const auto& bytes=request.bytes;require(state.state==1&&bytes.size()==44&&u16(bytes.data()+2)==0,1,2,"Native RAW BEGIN is invalid.");
 state.mode=bytes[0];state.tier=bytes[1];const auto length=u64(bytes.data()+4);
 require(state.mode>=1&&state.mode<=4&&state.tier<=2&&!(state.mode==4&&state.tier!=0),2,2,"Native RAW mode or tier is unsupported.");
 require(length>0&&length<=engine::maximum_input_bytes,2,2,"Native RAW input length exceeds its fixed profile.");
 state.expected_sha=hex(bytes.data()+12,32);state.input.resize(static_cast<std::size_t>(length));state.state=2;send(0x82,request.id,nullptr,0);
}
void data(const frame& request,context& state) {
 const auto& bytes=request.bytes;require(state.state==2&&bytes.size()>8&&bytes.size()<=wire::chunk_bytes+8,1,3,"Native RAW DATA is invalid.");
 const auto length=bytes.size()-8;require(u64(bytes.data())==state.input_at&&length<=state.input.size()-state.input_at,2,3,"Native RAW DATA offset or length differs.");
 std::memcpy(state.input.data()+state.input_at,bytes.data()+8,length);state.input_hash.update({reinterpret_cast<const std::byte*>(bytes.data()+8),length});state.input_at+=length;
 std::array<std::uint8_t,8> reply{};put(reply.data(),state.input_at,8);send(0x83,request.id,reply.data(),reply.size());
}
void seal(const frame& request,context& state) {
 require(state.state==2&&request.bytes.empty()&&state.input_at==state.input.size(),2,4,"Native RAW input is incomplete.");
 require(state.input_hash.finish_hex()==state.expected_sha,2,4,"Native RAW input SHA differs from its admitted source.");
 const auto mode=state.mode==1?engine::Mode::neutral:state.mode==2?engine::Mode::linear_headroom:state.mode==3?engine::Mode::highlight_recovery:engine::Mode::embedded;
 state.output=engine::decode(mode,state.input.data(),state.input.size());
 if(state.tier)state.output=engine::preview(state.output,state.tier==1?engine::Tier::thumbnail:engine::Tier::fit_screen);
 // No Main output allocation is announced while ingress or LibRaw work is live.
 wipe(state.input);const auto& output=state.output;sha256 digest;digest.update({reinterpret_cast<const std::byte*>(output.bytes.data()),output.bytes.size()});const auto hash=unhex(digest.finish_hex());
 std::array<std::uint8_t,64> reply{};reply[0]=state.mode;reply[1]=state.tier;reply[2]=format(output.format);reply[3]=static_cast<std::uint8_t>(output.raw_flip);
 put(reply.data()+4,output.width,4);put(reply.data()+8,output.height,4);reply[12]=static_cast<std::uint8_t>(output.channels);reply[13]=static_cast<std::uint8_t>(output.bits);
 put(reply.data()+16,output.bytes.size(),8);put(reply.data()+24,std::bit_cast<std::uint64_t>(output.exposure_scale),8);std::copy(hash.begin(),hash.end(),reply.begin()+32);
 send(0x84,request.id,reply.data(),reply.size());state.state=3;
}
void read(const frame& request,context& state) {
 require(state.state==3&&request.bytes.size()==12,1,5,"Native RAW READ is invalid.");const auto offset=u64(request.bytes.data());const auto length=u32(request.bytes.data()+8);
 require(offset==state.output_at&&length>0&&length<=wire::chunk_bytes&&length<=state.output.bytes.size()-state.output_at,4,5,"Native RAW output read differs from its admitted plane.");
 send(0x85,request.id,state.output.bytes.data()+state.output_at,length);state.output_at+=length;
}
int run(context& state,std::uint32_t& watermark) {
 for(;;) {
  frame request;receive(request,watermark);
  switch(request.operation) {
   case 1:init(request,state);break;case 2:begin(request,state);break;case 3:data(request,state);break;case 4:seal(request,state);break;case 5:read(request,state);break;
   case 6:require(state.state==3&&request.bytes.empty()&&state.output_at==state.output.bytes.size(),1,6,"Native RAW RELEASE is invalid.");state.clear();send(0x86,request.id,nullptr,0);return 0;
   default:throw refusal{1,1,"Native RAW operation is unsupported."};
  }
 }
}
void error(std::uint32_t id,std::uint16_t code,std::uint8_t phase,const char* message) noexcept {
 try {const auto size=std::min<std::size_t>(std::strlen(message),512);std::vector<std::uint8_t> bytes(6+size);put(bytes.data(),code,2);bytes[2]=phase;put(bytes.data()+4,size,2);std::memcpy(bytes.data()+6,message,size);send(0xff,id,bytes.data(),bytes.size());}catch(...){ }
}
} // namespace
int main() {
#ifdef LIGHTSCAPER_PHOTO_LINUX_BOOTSTRAP
 if (!lightscaper_photo_linux_bootstrap()) return 125;
#endif
#ifdef LIGHTSCAPER_PHOTO_MACOS_BOOTSTRAP
 if(!lightscaper::photo::macosBootstrap::lightscaperPhotoMacosBootstrap())return 125;
#endif
#ifdef _WIN32
 if(_setmode(_fileno(stdin),_O_BINARY)==-1||_setmode(_fileno(stdout),_O_BINARY)==-1)return 2;
#endif
 std::ios::sync_with_stdio(false);context state;std::uint32_t watermark=0;
 try {return run(state,watermark);}
 catch(const refusal& value){state.clear();error(watermark,value.code,value.phase,value.message);return 2;}
 catch(const std::exception&){state.clear();error(watermark,3,4,"Native RAW processing refused.");return 2;}
 catch(...){state.clear();error(watermark,3,4,"Native RAW processing raised an unsupported error.");return 2;}
}
