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

#include "nfc_capture.grpc.pb.h"

using grpc::Channel;
using grpc::ClientContext;
using grpc::Status;

class SignalCaptureClient
{
public:
   explicit SignalCaptureClient(std::shared_ptr<Channel> channel)
      : stub(nfc::SignalCapture::NewStub(channel))
   {
   }

   bool start()
   {
      nfc::StartRequest request;
      nfc::StartResponse response;
      ClientContext context;

      Status status = stub->Start(&context, request, &response);

      if (!status.ok())
      {
         std::cerr << "[test-rpc-client] start failed: " << status.error_message() << std::endl;
         return false;
      }

      std::cout << "[test-rpc-client] start response: success=" << response.success()
                << " message=\"" << response.message() << "\"" << std::endl;

      return response.success();
   }

   bool stop()
   {
      nfc::StopRequest request;
      nfc::StopResponse response;
      ClientContext context;

      Status status = stub->Stop(&context, request, &response);

      if (!status.ok())
      {
         std::cerr << "[test-rpc-client] stop failed: " << status.error_message() << std::endl;
         return false;
      }

      std::cout << "[test-rpc-client] stop response: success=" << response.success()
                << " message=\"" << response.message() << "\"" << std::endl;

      return response.success();
   }

private:
   std::unique_ptr<nfc::SignalCapture::Stub> stub;
};

void printUsage(const char *name)
{
   std::cout << "Usage: " << name << " [host:port] [start|stop]" << std::endl;
   std::cout << "  host:port  server address (default: localhost:50051)" << std::endl;
   std::cout << "  start      call Start only" << std::endl;
   std::cout << "  stop       call Stop only" << std::endl;
   std::cout << "  (none)     call Start then Stop" << std::endl;
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
      else if (arg == "start" || arg == "stop")
      {
         command = arg;
      }
      else
      {
         address = arg;
      }
   }

   SignalCaptureClient client(grpc::CreateChannel(address, grpc::InsecureChannelCredentials()));

   std::cout << "[test-rpc-client] connecting to " << address << std::endl;

   if (command == "start")
   {
      return client.start() ? 0 : 1;
   }
   else if (command == "stop")
   {
      return client.stop() ? 0 : 1;
   }
   else
   {
      bool ok = client.start() && client.stop();
      return ok ? 0 : 1;
   }
}