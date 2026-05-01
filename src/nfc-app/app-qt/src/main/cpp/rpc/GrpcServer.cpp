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

#include <grpcpp/grpcpp.h>

#include "GrpcControl.h"
#include "GrpcServer.h"

GrpcServer::GrpcServer(int port, QObject *target) : mPort(port), mTarget(target)
{
}

GrpcServer::~GrpcServer()
{
   stop();
}

void GrpcServer::start()
{
   mService = std::make_unique<GrpcControl>(mTarget);

   grpc::ServerBuilder builder;
   builder.AddListeningPort("0.0.0.0:" + std::to_string(mPort), grpc::InsecureServerCredentials());
   builder.RegisterService(mService.get());

   mServer = builder.BuildAndStart();

   if (mServer)
      qInfo() << "gRPC server listening on port" << mPort;
   else
      qWarning() << "gRPC server failed to start on port" << mPort;
}

void GrpcServer::stop()
{
   if (mServer)
   {
      qInfo() << "stopping gRPC server";
      mServer->Shutdown();
      mServer.reset();
   }
}
