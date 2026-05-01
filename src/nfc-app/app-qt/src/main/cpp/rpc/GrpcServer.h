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

#ifndef APP_GRPCSERVER_H
#define APP_GRPCSERVER_H

#include <memory>

class QObject;
class GrpcControl;

namespace grpc { class Server; }

class GrpcServer
{
   public:

      GrpcServer(int port, QObject *target);

      ~GrpcServer();

      void start();

      void stop();

   private:

      int mPort;

      QObject *mTarget;

      std::unique_ptr<GrpcControl> mService;

      std::unique_ptr<grpc::Server> mServer;
};

#endif //APP_GRPCSERVER_H
