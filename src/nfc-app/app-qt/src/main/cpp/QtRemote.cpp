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

#include <QDebug>
#include <QSettings>

#ifdef ENABLE_GRPC_REMOTE
#include <grpcpp/grpcpp.h>
#include "rpc/GrpcControl.h"
#endif

#include <events/SystemShutdownEvent.h>
#include <events/SystemStartupEvent.h>

#include "QtRemote.h"

struct QtRemote::Impl
{
   // configuration
   QSettings settings;

#ifdef ENABLE_GRPC_REMOTE
   std::unique_ptr<GrpcControl> control;
   std::unique_ptr<grpc::Server> server;
#endif

   Impl()
   {
#ifdef ENABLE_GRPC_REMOTE
      control = std::make_unique<GrpcControl>();
#endif
   }

   ~Impl()
   {
      stop();
   }

   void start()
   {
#ifdef ENABLE_GRPC_REMOTE
      // start gRPC server if configured
      const int port = settings.value("grpc/port", 0).toInt();

      if (port <= 0)
      {
         qInfo() << "gRPC server disabled";
         return;
      }

      grpc::ServerBuilder builder;
      builder.AddListeningPort("0.0.0.0:" + std::to_string(port), grpc::InsecureServerCredentials());
      builder.RegisterService(control.get());

      server = builder.BuildAndStart();

      if (server)
         qInfo() << "gRPC server listening on port" << port;
      else
         qWarning() << "gRPC server failed to start on port" << port;
#endif
   }

   void stop()
   {
#ifdef ENABLE_GRPC_REMOTE
      if (server)
      {
         qInfo() << "stopping gRPC server";
         server->Shutdown();
         server.reset();
      }
#endif
   }
};

QtRemote::QtRemote() : impl(new Impl())
{
}

void QtRemote::handleEvent(QEvent *event) const
{
   if (event->type() == SystemStartupEvent::Type)
      impl->start();
   else if (event->type() == SystemShutdownEvent::Type)
      impl->stop();
}
