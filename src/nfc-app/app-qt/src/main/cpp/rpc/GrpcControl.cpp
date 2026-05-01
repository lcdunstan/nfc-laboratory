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

#include <QDebug>
#include <QCoreApplication>

#include <events/DecoderControlEvent.h>

#include "GrpcControl.h"

GrpcControl::GrpcControl(QObject *target) : mTarget(target)
{
}

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

grpc::Status GrpcControl::execute(int command, ControlResponse *resp)
{
   std::promise<DecoderControlEvent::Result> promise;
   auto future = promise.get_future();

   auto *event = new DecoderControlEvent(command);
   event->completion = std::make_shared<std::promise<DecoderControlEvent::Result>>(std::move(promise));

   QCoreApplication::postEvent(mTarget, event);

   if (future.wait_for(std::chrono::seconds(5)) == std::future_status::timeout)
   {
      qWarning() << "gRPC command" << command << "timed out after 5 seconds";
      resp->set_success(false);
      resp->set_message("timeout");
      resp->set_state(State::UNKNOWN);
      return grpc::Status::OK;
   }

   auto result = future.get();
   resp->set_success(result.success);
   resp->set_message(result.message.toStdString());
   resp->set_state(static_cast<State>(result.state));
   return grpc::Status::OK;
}
