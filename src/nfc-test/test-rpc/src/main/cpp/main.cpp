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

using grpc::Server;
using grpc::ServerBuilder;
using grpc::ServerContext;
using grpc::Status;

class SignalCaptureImpl final : public nfc::SignalCapture::Service
{
   Status Start(ServerContext *context, const nfc::StartRequest *request, nfc::StartResponse *response) override
   {
      std::cout << "[test-rpc] start capture requested" << std::endl;
      response->set_success(true);
      response->set_message("capture started");
      return Status::OK;
   }

   Status Stop(ServerContext *context, const nfc::StopRequest *request, nfc::StopResponse *response) override
   {
      std::cout << "[test-rpc] stop capture requested" << std::endl;
      response->set_success(true);
      response->set_message("capture stopped");
      return Status::OK;
   }
};

int main(int argc, char *argv[])
{
   std::cout << "***********************************************************************" << std::endl;
   std::cout << "NFC laboratory, 2024 Jose Vicente Campos Martinez - <josevcm@gmail.com>" << std::endl;
   std::cout << "***********************************************************************" << std::endl;

   std::string address = "0.0.0.0:50051";

   SignalCaptureImpl service;

   ServerBuilder builder;
   builder.AddListeningPort(address, grpc::InsecureServerCredentials());
   builder.RegisterService(&service);

   std::unique_ptr<Server> server(builder.BuildAndStart());

   std::cout << "[test-rpc] server listening on " << address << std::endl;

   server->Wait();

   return 0;
}