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

#include <iostream>
#include <memory>
#include <string>

#include <grpcpp/grpcpp.h>

#include "nfc_control.grpc.pb.h"

using grpc::Channel;
using grpc::ClientContext;
using grpc::Status;

static const char *stateToString(State state)
{
   switch (state)
   {
      case State::IDLE:    return "idle";
      case State::RUNNING: return "running";
      case State::PAUSED:  return "paused";
      default:             return "unknown";
   }
}

class RemoteControlClient
{
public:
   explicit RemoteControlClient(std::shared_ptr<Channel> channel)
      : stub(RemoteControl::NewStub(channel))
   {
   }

   bool execute(const std::string &command)
   {
      ControlRequest request;
      ControlResponse response;
      ClientContext context;
      Status status;

      if (command == "start")
         status = stub->Start(&context, request, &response);
      else if (command == "stop")
         status = stub->Stop(&context, request, &response);
      else if (command == "pause")
         status = stub->Pause(&context, request, &response);
      else if (command == "resume")
         status = stub->Resume(&context, request, &response);
      else
      {
         std::cerr << "[test-rpc-client] unknown command: " << command << std::endl;
         return false;
      }

      if (!status.ok())
      {
         std::cerr << "[test-rpc-client] " << command << " failed: " << status.error_message() << std::endl;
         return false;
      }

      std::cout << "[test-rpc-client] " << command << " response:"
                << " success=" << (response.success() ? "true" : "false")
                << " message=\"" << response.message() << "\""
                << " state=" << stateToString(response.state())
                << std::endl;

      return response.success();
   }

private:
   std::unique_ptr<RemoteControl::Stub> stub;
};

void printUsage(const char *name)
{
   std::cout << "Usage: " << name << " [host:port] <command>" << std::endl;
   std::cout << "  host:port  server address (default: localhost:50051)" << std::endl;
   std::cout << "  start      start capture" << std::endl;
   std::cout << "  stop       stop capture" << std::endl;
   std::cout << "  pause      pause capture" << std::endl;
   std::cout << "  resume     resume capture" << std::endl;
}

int main(int argc, char *argv[])
{
   std::cout << "***********************************************************************" << std::endl;
   std::cout << "NFC laboratory, 2024 Jose Vicente Campos Martinez - <josevcm@gmail.com>" << std::endl;
   std::cout << "***********************************************************************" << std::endl;

   std::string address = "localhost:50051";
   std::string command;

   for (int i = 1; i < argc; ++i)
   {
      std::string arg(argv[i]);

      if (arg == "--help" || arg == "-h")
      {
         printUsage(argv[0]);
         return 0;
      }
      else if (arg == "start" || arg == "stop" || arg == "pause" || arg == "resume")
      {
         command = arg;
      }
      else
      {
         address = arg;
      }
   }

   if (command.empty())
   {
      printUsage(argv[0]);
      return 1;
   }

   RemoteControlClient client(grpc::CreateChannel(address, grpc::InsecureChannelCredentials()));

   std::cout << "[test-rpc-client] connecting to " << address << std::endl;

   return client.execute(command) ? 0 : 1;
}
