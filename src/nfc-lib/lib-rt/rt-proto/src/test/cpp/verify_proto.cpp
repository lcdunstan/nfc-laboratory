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
#include "ping.pb.h"

int main()
{
   GOOGLE_PROTOBUF_VERIFY_VERSION;

   nfc::proto::Ping ping;
   ping.set_label("hello");
   ping.set_timestamp(42);

   std::string serialized;
   ping.SerializeToString(&serialized);

   nfc::proto::Ping decoded;
   decoded.ParseFromString(serialized);

   std::cout << "label: "     << decoded.label()     << std::endl;
   std::cout << "timestamp: " << decoded.timestamp() << std::endl;

   google::protobuf::ShutdownProtobufLibrary();
   return 0;
}
