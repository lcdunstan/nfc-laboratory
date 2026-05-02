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

#include <chrono>
#include <future>
#include <memory>
#include <thread>

#include <QDebug>

#include <events/DecoderControlEvent.h>

#include "GrpcControl.h"

#include "QtApplication.h"

grpc::Status GrpcControl::Start(grpc::ServerContext *ctx, const ControlRequest *req, ControlResponse *resp)
{
   return execute(DecoderControlEvent::Start, resp);
}

grpc::Status GrpcControl::Stop(grpc::ServerContext *ctx, const ControlRequest *req, ControlResponse *resp)
{
   return execute(DecoderControlEvent::Stop, resp);
}

grpc::Status GrpcControl::Pause(grpc::ServerContext *ctx, const ControlRequest *req, ControlResponse *resp)
{
   return execute(DecoderControlEvent::Pause, resp);
}

grpc::Status GrpcControl::Resume(grpc::ServerContext *ctx, const ControlRequest *req, ControlResponse *resp)
{
   return execute(DecoderControlEvent::Resume, resp);
}

grpc::Status GrpcControl::Subscribe(grpc::ServerContext *ctx, const SubscribeRequest *req, grpc::ServerWriter<EventNotification> *writer)
{
   qInfo() << "gRPC Subscribe: client connected, filter size:" << req->filter_size();

   // TODO: register writer with the event publishing mechanism so that
   //       Qt event handlers can push EventNotification messages here.

   while (!ctx->IsCancelled())
      std::this_thread::sleep_for(std::chrono::milliseconds(50));

   // TODO: unregister writer before returning.

   qInfo() << "gRPC Subscribe: client disconnected";

   return grpc::Status::OK;
}

grpc::Status GrpcControl::execute(const int command, ControlResponse *resp)
{
   const auto promise = std::make_shared<std::promise<DecoderControlEvent::Result>>();

   auto *event = new DecoderControlEvent(command);

   QtApplication::post(event->promise(promise));

   auto future = promise->get_future();

   if (future.wait_for(std::chrono::seconds(5)) == std::future_status::timeout)
   {
      qWarning() << "gRPC command" << command << "timed out after 5 seconds";

      resp->set_success(false);
      resp->set_message("timeout");
      resp->set_state(UNKNOWN);
      return grpc::Status::OK;
   }

   auto [success, message, state] = future.get();

   resp->set_success(success);
   resp->set_message(message.toStdString());
   resp->set_state(static_cast<State>(state));

   return grpc::Status::OK;
}
