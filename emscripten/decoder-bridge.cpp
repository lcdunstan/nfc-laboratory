/*

  This file is part of NFC-LABORATORY.

  Copyright (C) 2024 Jose Vicente Campos Martinez, <josevcm@gmail.com>

  NFC-LABORATORY is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  NFC-LABORATORY is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with NFC-LABORATORY. If not, see <http://www.gnu.org/licenses/>.

*/

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <string>
#include <list>

#include <hw/SignalBuffer.h>
#include <hw/SignalType.h>

#include <lab/nfc/Nfc.h>
#include <lab/nfc/NfcDecoder.h>

#include <lab/data/RawFrame.h>

#include <nlohmann/json.hpp>

using json = nlohmann::json;

extern "C" {

struct DecoderState
{
   lab::NfcDecoder decoder;
   unsigned int sampleRate;
   double streamTime;
   unsigned long samplesProcessed{0};
   std::list<lab::RawFrame> frameQueue;
};

DecoderState *decoder_create(unsigned int sampleRate)
{
   try
   {
      auto *state = new DecoderState();

      state->sampleRate = sampleRate;
      state->streamTime = 0;

      state->decoder.setEnableDebug(false);
      state->decoder.setEnableNfcA(true);
      state->decoder.setEnableNfcB(true);
      state->decoder.setEnableNfcF(true);
      state->decoder.setEnableNfcV(true);
      state->decoder.setSampleRate(sampleRate);
      state->decoder.setStreamTime(0);
      state->decoder.initialize();

      return state;
   }
   catch (...)
   {
      return nullptr;
   }
}

void decoder_feed(DecoderState *state, const float *samples, int count)
{
   if (!state || !samples || count <= 0)
      return;

   try
   {
      hw::SignalBuffer buffer(const_cast<float *>(samples), static_cast<unsigned int>(count), 1, 1, state->sampleRate, 0, 0, hw::SIGNAL_TYPE_RADIO_SAMPLES);

      auto frames = state->decoder.nextFrames(buffer);

      state->frameQueue.splice(state->frameQueue.end(), frames);

      state->samplesProcessed += count;
   }
   catch (...)
   {
   }
}

int decoder_poll_frames(DecoderState *state, char *jsonOut, int maxLen)
{
   if (!state || !jsonOut || maxLen <= 0)
      return 0;

   try
   {
      hw::SignalBuffer invalid;

      auto frames = state->decoder.nextFrames(invalid);

      state->frameQueue.splice(state->frameQueue.end(), frames);

      json result = json::array();

      for (const auto &frame : state->frameQueue)
      {
         char buffer[4096];

         frame.reduce<int>(0, [&buffer](int offset, unsigned char value) {
            return offset + snprintf(buffer + offset, sizeof(buffer) - offset, offset > 0 ? ":%02X" : "%02X", value);
         });

         result.push_back({
            {"techType", frame.techType()},
            {"dateTime", frame.dateTime()},
            {"sampleStart", static_cast<long long>(frame.sampleStart())},
            {"sampleEnd", static_cast<long long>(frame.sampleEnd())},
            {"sampleRate", static_cast<long long>(frame.sampleRate())},
            {"timeStart", frame.timeStart()},
            {"timeEnd", frame.timeEnd()},
            {"frameType", frame.frameType()},
            {"frameRate", frame.frameRate()},
            {"frameFlags", frame.frameFlags()},
            {"framePhase", frame.framePhase()},
            {"frameData", buffer}
         });
      }

      state->frameQueue.clear();

      std::string dump = result.dump();

      if (static_cast<int>(dump.size()) < maxLen)
      {
         std::memcpy(jsonOut, dump.c_str(), dump.size() + 1);
         return static_cast<int>(dump.size());
      }

      return 0;
   }
   catch (...)
   {
      return 0;
   }
}

void decoder_configure(DecoderState *state, const char *jsonConfig)
{
   if (!state || !jsonConfig)
      return;

   try
   {
      json config = json::parse(jsonConfig);

      if (config.contains("sampleRate"))
         state->sampleRate = config["sampleRate"];

      if (config.contains("streamTime"))
         state->streamTime = config["streamTime"];

      if (config.contains("sampleRate"))
         state->decoder.setSampleRate(state->sampleRate);

      if (config.contains("streamTime"))
         state->decoder.setStreamTime(static_cast<long>(state->streamTime));

      if (config.contains("debugEnabled"))
         state->decoder.setEnableDebug(config["debugEnabled"]);

      if (config.contains("protocol"))
      {
         const auto &proto = config["protocol"];
         if (proto.contains("nfca"))
            state->decoder.setEnableNfcA(proto["nfca"]["enabled"]);
         if (proto.contains("nfcb"))
            state->decoder.setEnableNfcB(proto["nfcb"]["enabled"]);
         if (proto.contains("nfcf"))
            state->decoder.setEnableNfcF(proto["nfcf"]["enabled"]);
         if (proto.contains("nfcv"))
            state->decoder.setEnableNfcV(proto["nfcv"]["enabled"]);

         state->decoder.initialize();
      }
   }
   catch (...)
   {
   }
}

void decoder_destroy(DecoderState *state)
{
   if (state)
   {
      state->decoder.cleanup();
      delete state;
   }
}

int decoder_get_status(DecoderState *state, char *jsonOut, int maxLen)
{
   if (!state || !jsonOut || maxLen <= 0)
      return 0;

   try
   {
      json result = {
         {"frameQueue", static_cast<int>(state->frameQueue.size())},
         {"samplesProcessed", static_cast<long long>(state->samplesProcessed)},
         {"sampleRate", state->sampleRate},
         {"streamTime", state->streamTime},
      };

      std::string dump = result.dump();

      if (static_cast<int>(dump.size()) < maxLen)
      {
         std::memcpy(jsonOut, dump.c_str(), dump.size() + 1);
         return static_cast<int>(dump.size());
      }

      return 0;
   }
   catch (...)
   {
      return 0;
   }
}

}
