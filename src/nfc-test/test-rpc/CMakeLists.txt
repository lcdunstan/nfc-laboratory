set(CMAKE_CXX_STANDARD 17)

find_package(Protobuf CONFIG REQUIRED)
find_package(gRPC CONFIG REQUIRED)

set(PRIVATE_SOURCE_DIR   ${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp)
set(PROTO_DIR            ${CMAKE_CURRENT_SOURCE_DIR}/src/main/proto)
set(PROTO_FILE           ${PROTO_DIR}/nfc_capture.proto)
set(PROTO_GEN_DIR        ${CMAKE_CURRENT_BINARY_DIR})
set(CONTROL_PROTO_DIR    ${CMAKE_SOURCE_DIR}/src/nfc-app/app-qt/src/main/proto)
set(CONTROL_PROTO_FILE   ${CONTROL_PROTO_DIR}/nfc_control.proto)

get_target_property(GRPC_CPP_PLUGIN gRPC::grpc_cpp_plugin LOCATION)

add_custom_command(
        OUTPUT
            ${PROTO_GEN_DIR}/nfc_capture.pb.cc
            ${PROTO_GEN_DIR}/nfc_capture.pb.h
            ${PROTO_GEN_DIR}/nfc_capture.grpc.pb.cc
            ${PROTO_GEN_DIR}/nfc_capture.grpc.pb.h
        COMMAND $<TARGET_FILE:protobuf::protoc>
        ARGS
            --grpc_out=${PROTO_GEN_DIR}
            --cpp_out=${PROTO_GEN_DIR}
            --plugin=protoc-gen-grpc=${GRPC_CPP_PLUGIN}
            -I${PROTO_DIR}
            ${PROTO_FILE}
        DEPENDS ${PROTO_FILE}
        COMMENT "Generating gRPC/protobuf stubs from nfc_capture.proto"
)

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
            -I${CONTROL_PROTO_DIR}
            ${CONTROL_PROTO_FILE}
        DEPENDS ${CONTROL_PROTO_FILE}
        COMMENT "Generating gRPC/protobuf stubs from nfc_control.proto"
)

if (WIN32)
    set(PLATFORM_LIBS mingw32 psapi)
endif ()

# proto stubs for SignalCapture service (used by server)
add_library(nfc-capture-proto STATIC
        ${PROTO_GEN_DIR}/nfc_capture.pb.cc
        ${PROTO_GEN_DIR}/nfc_capture.grpc.pb.cc
)

target_include_directories(nfc-capture-proto PUBLIC ${PROTO_GEN_DIR})

target_link_libraries(nfc-capture-proto
        gRPC::grpc++
        protobuf::libprotobuf
)

# proto stubs for RemoteControl service (used by client)
add_library(nfc-control-proto STATIC
        ${PROTO_GEN_DIR}/nfc_control.pb.cc
        ${PROTO_GEN_DIR}/nfc_control.grpc.pb.cc
)

target_include_directories(nfc-control-proto PUBLIC ${PROTO_GEN_DIR})

target_link_libraries(nfc-control-proto
        gRPC::grpc++
        protobuf::libprotobuf
)

# server
add_executable(test-rpc
        src/main/cpp/main.cpp
)

target_include_directories(test-rpc PRIVATE ${PRIVATE_SOURCE_DIR})

target_link_libraries(test-rpc
        ${PLATFORM_LIBS}
        nfc-capture-proto
)

# client
add_executable(test-rpc-client
        src/main/cpp/client.cpp
)

target_include_directories(test-rpc-client PRIVATE ${PRIVATE_SOURCE_DIR})

target_link_libraries(test-rpc-client
        ${PLATFORM_LIBS}
        nfc-control-proto
)