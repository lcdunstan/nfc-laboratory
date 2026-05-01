# gRPC Remote Control Server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a gRPC server to `app-qt` that accepts `Start`, `Stop`, `Pause`, and `Resume` commands and fires the corresponding `DecoderControlEvent` into the Qt event loop, returning the resulting application state to the caller.

**Architecture:** `GrpcServer` owns a gRPC server (running in gRPC's internal threads) that registers a `GrpcControl` service. Each RPC posts a `DecoderControlEvent` to the Qt main event loop via `QCoreApplication::postEvent()`, waits up to 5 seconds for `QtControl` to resolve a `std::promise<DecoderControlEvent::Result>` embedded in the event, then maps the result to a `ControlResponse`. The server is instantiated in `QtApplication::Impl` only when `grpc/port > 0` in `QSettings`.

**Tech Stack:** C++17, Qt6, gRPC (`gRPC::grpc++`), protobuf (`protobuf::libprotobuf`), CMake 3.x

---

## File Map

| Action  | File |
|---------|------|
| Modify  | `src/nfc-app/app-qt/src/main/cpp/events/DecoderControlEvent.h` |
| Modify  | `src/nfc-app/app-qt/src/main/cpp/QtControl.cpp` |
| Modify  | `src/nfc-app/app-qt/src/main/cpp/QtApplication.cpp` |
| Modify  | `src/nfc-app/app-qt/CMakeLists.txt` |
| Create  | `src/nfc-app/app-qt/src/main/proto/nfc_control.proto` |
| Create  | `src/nfc-app/app-qt/src/main/cpp/rpc/GrpcControl.h` |
| Create  | `src/nfc-app/app-qt/src/main/cpp/rpc/GrpcControl.cpp` |
| Create  | `src/nfc-app/app-qt/src/main/cpp/rpc/GrpcServer.h` |
| Create  | `src/nfc-app/app-qt/src/main/cpp/rpc/GrpcServer.cpp` |

---

## Task 1: Add `Result` struct and `completion` field to `DecoderControlEvent`

**Files:**
- Modify: `src/nfc-app/app-qt/src/main/cpp/events/DecoderControlEvent.h`

- [ ] **Step 1: Add includes and `Result` struct to `DecoderControlEvent.h`**

  Add `#include <future>` and `#include <memory>` at the top (after existing includes), then add the `Result` struct and `completion` field as public members inside the class — place them right before the `private:` section:

  ```cpp
  // after the existing #include <QVariant> line, add:
  #include <future>
  #include <memory>
  ```

  Inside the class body, before `private:`, add:

  ```cpp
  public:

     struct Result
     {
        bool    success;
        QString message;
        int     state; // 0=unknown, 1=idle, 2=running, 3=paused
     };

     std::shared_ptr<std::promise<Result>> completion;
  ```

  The final `DecoderControlEvent.h` (full content):

  ```cpp
  /*
    ... (keep existing license header) ...
  */

  #ifndef APP_DECODECONTROLEVENT_H
  #define APP_DECODECONTROLEVENT_H

  #include <future>
  #include <memory>

  #include <QEvent>
  #include <QMap>
  #include <QVariant>

  class DecoderControlEvent : public QEvent
  {
     public:

        static int Type;

        enum Command
        {
           Start,
           Stop,
           Pause,
           Resume,
           Clear,
           Change,
           ReadFile,
           WriteFile,
           LogicDeviceConfig,
           LogicDecoderConfig,
           RadioDeviceConfig,
           RadioDecoderConfig,
           FourierConfig,
        };

        struct Result
        {
           bool    success;
           QString message;
           int     state; // 0=unknown, 1=idle, 2=running, 3=paused
        };

        std::shared_ptr<std::promise<Result>> completion;

     public:

        explicit DecoderControlEvent(int command);

        explicit DecoderControlEvent(int command, QMap<QString, QVariant> parameters);

        explicit DecoderControlEvent(int command, const QString &name, int value);

        explicit DecoderControlEvent(int command, const QString &name, float value);

        explicit DecoderControlEvent(int command, const QString &name, bool value);

        explicit DecoderControlEvent(int command, const QString &name, const QString &value);

        int command() const;

        bool contains(const QString &name) const;

        const QMap<QString, QVariant> &parameters() const;

        DecoderControlEvent *setInteger(const QString &name, int value);

        int getInteger(const QString &name, int defVal = 0) const;

        DecoderControlEvent *setFloat(const QString &name, float value);

        float getFloat(const QString &name, float defVal = 0.0) const;

        DecoderControlEvent *setDouble(const QString &name, double value);

        double getDouble(const QString &name, double defVal = 0.0) const;

        DecoderControlEvent *setBoolean(const QString &name, bool value);

        bool getBoolean(const QString &name, bool defVal = false) const;

        DecoderControlEvent *setString(const QString &name, const QString &value);

        QString getString(const QString &name, const QString &defVal = {}) const;

     private:

        int mCommand;

        QMap<QString, QVariant> mParameters;
  };

  #endif // DECODECONTROLEVENT_H
  ```

- [ ] **Step 2: Verify the project still compiles**

  ```
  cmake --build . --target nfc-lab 2>&1 | tail -20
  ```

  Expected: no new errors. The `completion` field is `nullptr` by default (shared_ptr default-constructs to null), so existing code is unaffected.

- [ ] **Step 3: Commit**

  ```
  git add src/nfc-app/app-qt/src/main/cpp/events/DecoderControlEvent.h
  git commit -m "feat: add Result struct and completion promise to DecoderControlEvent"
  ```

---

## Task 2: Resolve `completion` promise in `QtControl` handlers

**Files:**
- Modify: `src/nfc-app/app-qt/src/main/cpp/QtControl.cpp` (lines 407–490)

State integer values used in `Result.state`: `0=UNKNOWN`, `1=IDLE`, `2=RUNNING`, `3=PAUSED`.

- [ ] **Step 1: Update `doStartDecode` to capture and resolve the promise inside the async callback**

  Replace the existing `doStartDecode` method (lines 407–438):

  ```cpp
  void doStartDecode(DecoderControlEvent *event)
  {
     qInfo() << "start decoder and receiver tasks";

     auto completion = event->completion;

     if (event->contains("storagePath"))
     {
        storagePath = event->getString("storagePath");

        taskStorageClear([=] {
           taskRecorderWrite({{"storagePath", storagePath}}, [=] {
              startDecoders();
              if (completion)
                 completion->set_value({true, "running", 2});
           });
        });
     }
     else
     {
        storagePath = QString();

        taskStorageClear([=] {
           startDecoders();
           if (completion)
              completion->set_value({true, "running", 2});
        });
     }
  }
  ```

- [ ] **Step 2: Update `doStopDecode` to resolve the promise**

  Replace the existing `doStopDecode` method (lines 443–458):

  ```cpp
  void doStopDecode(DecoderControlEvent *event) const
  {
     qInfo() << "stop decoder and receiver tasks";

     if (!logicDeviceType.isEmpty())
        taskLogicDeviceStop();

     if (!radioDeviceType.isEmpty())
        taskRadioDeviceStop();

     if (!storagePath.isEmpty())
        taskRecorderStop();

     if (event->completion)
        event->completion->set_value({true, "stopped", 1});
  }
  ```

- [ ] **Step 3: Update `doPauseDecode` to resolve the promise**

  Replace the existing `doPauseDecode` method (lines 463–474):

  ```cpp
  void doPauseDecode(DecoderControlEvent *event) const
  {
     qInfo() << "pause decoder and receiver tasks";

     if (!logicDeviceType.isEmpty())
        taskLogicDevicePause();

     if (!radioDeviceType.isEmpty())
        taskRadioDevicePause();

     if (event->completion)
        event->completion->set_value({true, "paused", 3});
  }
  ```

- [ ] **Step 4: Update `doResumeDecode` to resolve the promise**

  Replace the existing `doResumeDecode` method (lines 479–490):

  ```cpp
  void doResumeDecode(DecoderControlEvent *event) const
  {
     qInfo() << "resume decoder and receiver tasks";

     if (!logicDeviceType.isEmpty())
        taskLogicDeviceResume();

     if (!radioDeviceType.isEmpty())
        taskRadioDeviceResume();

     if (event->completion)
        event->completion->set_value({true, "running", 2});
  }
  ```

- [ ] **Step 5: Verify the project still compiles**

  ```
  cmake --build . --target nfc-lab 2>&1 | tail -20
  ```

  Expected: no errors.

- [ ] **Step 6: Commit**

  ```
  git add src/nfc-app/app-qt/src/main/cpp/QtControl.cpp
  git commit -m "feat: resolve DecoderControlEvent completion promise in QtControl handlers"
  ```

---

## Task 3: Create the proto file

**Files:**
- Create: `src/nfc-app/app-qt/src/main/proto/nfc_control.proto`

- [ ] **Step 1: Create the proto directory and file**

  ```
  mkdir -p src/nfc-app/app-qt/src/main/proto
  ```

  Create `src/nfc-app/app-qt/src/main/proto/nfc_control.proto`:

  ```proto
  syntax = "proto3";

  service RemoteControl {
    rpc Start  (ControlRequest) returns (ControlResponse);
    rpc Stop   (ControlRequest) returns (ControlResponse);
    rpc Pause  (ControlRequest) returns (ControlResponse);
    rpc Resume (ControlRequest) returns (ControlResponse);
  }

  message ControlRequest {}

  message ControlResponse {
    bool   success = 1;
    string message = 2;
    State  state   = 3;
  }

  enum State {
    UNKNOWN = 0;
    IDLE    = 1;
    RUNNING = 2;
    PAUSED  = 3;
  }
  ```

- [ ] **Step 2: Commit**

  ```
  git add src/nfc-app/app-qt/src/main/proto/nfc_control.proto
  git commit -m "feat: add nfc_control.proto for gRPC remote control service"
  ```

---

## Task 4: Create `GrpcControl`

**Files:**
- Create: `src/nfc-app/app-qt/src/main/cpp/rpc/GrpcControl.h`
- Create: `src/nfc-app/app-qt/src/main/cpp/rpc/GrpcControl.cpp`

`GrpcControl` inherits from the protoc-generated `RemoteControl::Service`. Each RPC creates a `DecoderControlEvent` with a `completion` promise, posts it to the Qt event loop, and waits for the result.

- [ ] **Step 1: Create `GrpcControl.h`**

  ```cpp
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

  #ifndef APP_GRPCCONTROL_H
  #define APP_GRPCCONTROL_H

  #include <grpcpp/grpcpp.h>

  #include "nfc_control.grpc.pb.h"

  class QObject;

  class GrpcControl : public RemoteControl::Service
  {
     public:

        explicit GrpcControl(QObject *target);

        grpc::Status Start(grpc::ServerContext *ctx, const ControlRequest *req, ControlResponse *resp) override;

        grpc::Status Stop(grpc::ServerContext *ctx, const ControlRequest *req, ControlResponse *resp) override;

        grpc::Status Pause(grpc::ServerContext *ctx, const ControlRequest *req, ControlResponse *resp) override;

        grpc::Status Resume(grpc::ServerContext *ctx, const ControlRequest *req, ControlResponse *resp) override;

     private:

        grpc::Status execute(int command, ControlResponse *resp);

        QObject *mTarget;
  };

  #endif //APP_GRPCCONTROL_H
  ```

- [ ] **Step 2: Create `GrpcControl.cpp`**

  ```cpp
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
  ```

- [ ] **Step 3: Commit**

  ```
  git add src/nfc-app/app-qt/src/main/cpp/rpc/GrpcControl.h
  git add src/nfc-app/app-qt/src/main/cpp/rpc/GrpcControl.cpp
  git commit -m "feat: add GrpcControl — implements RemoteControl::Service over Qt events"
  ```

---

## Task 5: Create `GrpcServer`

**Files:**
- Create: `src/nfc-app/app-qt/src/main/cpp/rpc/GrpcServer.h`
- Create: `src/nfc-app/app-qt/src/main/cpp/rpc/GrpcServer.cpp`

`GrpcServer` owns the gRPC server and the `GrpcControl` service instance.

- [ ] **Step 1: Create `GrpcServer.h`**

  ```cpp
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
  ```

- [ ] **Step 2: Create `GrpcServer.cpp`**

  ```cpp
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
  ```

- [ ] **Step 3: Commit**

  ```
  git add src/nfc-app/app-qt/src/main/cpp/rpc/GrpcServer.h
  git add src/nfc-app/app-qt/src/main/cpp/rpc/GrpcServer.cpp
  git commit -m "feat: add GrpcServer — manages gRPC server lifecycle"
  ```

---

## Task 6: Integrate `GrpcServer` into `QtApplication`

**Files:**
- Modify: `src/nfc-app/app-qt/src/main/cpp/QtApplication.cpp`

- [ ] **Step 1: Add `GrpcServer` include and member to `QtApplication::Impl`**

  Add after the existing includes at the top of `QtApplication.cpp` (after line 47, `#include "QtApplication.h"`):

  ```cpp
  #include "rpc/GrpcServer.h"
  ```

  Add `grpcServer` as a member inside `struct QtApplication::Impl` (after `bool printFramesEnabled = false;` on line 78):

  ```cpp
  std::unique_ptr<GrpcServer> grpcServer;
  ```

- [ ] **Step 2: Instantiate and start `GrpcServer` in the `Impl` constructor**

  At the end of the `Impl` constructor body (after the `windowReloadConnection` line, before the closing `}`), add:

  ```cpp
  const int grpcPort = settings.value("grpc/port", 0).toInt();

  if (grpcPort > 0)
  {
     grpcServer = std::make_unique<GrpcServer>(grpcPort, app);
     grpcServer->start();
  }
  ```

- [ ] **Step 3: Stop `GrpcServer` in `shutdown()`**

  Replace the existing `shutdown()` method (lines 175–182):

  ```cpp
  void shutdown()
  {
     qInfo() << "shutdown QT Interface";

     if (grpcServer)
        grpcServer->stop();

     postEvent(instance(), new SystemShutdownEvent);

     shuttingDown = true;
  }
  ```

- [ ] **Step 4: Commit**

  ```
  git add src/nfc-app/app-qt/src/main/cpp/QtApplication.cpp
  git commit -m "feat: integrate GrpcServer into QtApplication, configured via grpc/port setting"
  ```

---

## Task 7: Update `CMakeLists.txt`

**Files:**
- Modify: `src/nfc-app/app-qt/CMakeLists.txt`

- [ ] **Step 1: Add gRPC/protobuf dependencies and proto generation**

  After line 1 (`set(CMAKE_CXX_STANDARD 17)`), insert the following block (before `set(CMAKE_AUTOMOC ON)`):

  ```cmake
  find_package(Protobuf CONFIG REQUIRED)
  find_package(gRPC CONFIG REQUIRED)

  set(PROTO_DIR     ${CMAKE_CURRENT_SOURCE_DIR}/src/main/proto)
  set(PROTO_FILE    ${PROTO_DIR}/nfc_control.proto)
  set(PROTO_GEN_DIR ${CMAKE_CURRENT_BINARY_DIR})

  get_target_property(GRPC_CPP_PLUGIN gRPC::grpc_cpp_plugin LOCATION)

  add_custom_command(
          OUTPUT
              ${PROTO_GEN_DIR}/nfc_control.pb.cc
              ${PROTO_GEN_DIR}/nfc_control.pb.h
              ${PROTO_GEN_DIR}/nfc_control.grpc.pb.cc
              ${PROTO_GEN_DIR}/nfc_control.grpc.pb.h
          COMMAND $<TARGET_FILE:protobuf::protoc>
          ARGS
              --grpc_out=${PROTO_GEN_DIR}
              --cpp_out=${PROTO_GEN_DIR}
              --plugin=protoc-gen-grpc=${GRPC_CPP_PLUGIN}
              -I${PROTO_DIR}
              ${PROTO_FILE}
          DEPENDS ${PROTO_FILE}
          COMMENT "Generating gRPC/protobuf stubs from nfc_control.proto"
  )

  add_library(nfc-control-proto STATIC
          ${PROTO_GEN_DIR}/nfc_control.pb.cc
          ${PROTO_GEN_DIR}/nfc_control.grpc.pb.cc
  )

  target_include_directories(nfc-control-proto PUBLIC ${PROTO_GEN_DIR})

  target_link_libraries(nfc-control-proto
          gRPC::grpc++
          protobuf::libprotobuf
  )
  ```

- [ ] **Step 2: Add `GrpcServer.cpp` and `GrpcControl.cpp` to SOURCES**

  In the `set(SOURCES ...)` block, after the `events/DecoderControlEvent.cpp` line, add:

  ```cmake
          ${PRIVATE_SOURCE_DIR}/rpc/GrpcControl.cpp
          ${PRIVATE_SOURCE_DIR}/rpc/GrpcServer.cpp
  ```

- [ ] **Step 3: Add `PROTO_GEN_DIR` to include directories and `nfc-control-proto` to link libraries**

  After `target_include_directories(nfc-lab PRIVATE ${LIBUSB_INCLUDE_DIRS})`, add:

  ```cmake
  target_include_directories(nfc-lab PRIVATE ${PROTO_GEN_DIR})
  ```

  In `target_link_libraries(nfc-lab ...)`, add `nfc-control-proto` at the end of the list (before the closing `)`):

  ```cmake
          nfc-control-proto
  ```

- [ ] **Step 4: Build and verify**

  From the build directory:

  ```
  cmake --build . --target nfc-lab 2>&1 | tail -30
  ```

  Expected: build completes with no errors. The generated files `nfc_control.pb.h` and `nfc_control.grpc.pb.h` should appear in the build directory.

- [ ] **Step 5: Smoke test — start the app and verify the gRPC server starts**

  Add `grpc/port=50051` to the app's `QSettings` ini file (location depends on platform — on Windows: `%APPDATA%\<OrgName>\<AppName>.ini`), start the app, and check the log for:

  ```
  gRPC server listening on port 50051
  ```

  Then use the existing `test-rpc-client` or `grpc_cli` to call `Start`:

  ```
  grpc_cli call localhost:50051 RemoteControl.Start ""
  ```

  Expected response:

  ```
  success: true
  message: "running"
  state: RUNNING
  ```

- [ ] **Step 6: Commit**

  ```
  git add src/nfc-app/app-qt/CMakeLists.txt
  git commit -m "feat: integrate gRPC/protobuf into app-qt CMakeLists, add nfc-control-proto library"
  ```
