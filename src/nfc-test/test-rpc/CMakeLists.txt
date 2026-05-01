set(CMAKE_CXX_STANDARD 17)

find_package(Protobuf CONFIG REQUIRED)
find_package(gRPC CONFIG REQUIRED)

set(PRIVATE_SOURCE_DIR   ${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp)
set(PROTO_GEN_DIR        ${CMAKE_CURRENT_BINARY_DIR})
set(CONTROL_PROTO_DIR    ${CMAKE_SOURCE_DIR}/src/nfc-app/app-qt/src/main/proto)
set(CONTROL_PROTO_FILE   ${CONTROL_PROTO_DIR}/nfc_control.proto)

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
            -I${CONTROL_PROTO_DIR}
            ${CONTROL_PROTO_FILE}
        DEPENDS ${CONTROL_PROTO_FILE}
        COMMENT "Generating gRPC/protobuf stubs from nfc_control.proto"
)

if (WIN32)
    set(PLATFORM_LIBS mingw32 psapi)
endif ()

add_library(nfc-control-proto STATIC
        ${PROTO_GEN_DIR}/nfc_control.pb.cc
        ${PROTO_GEN_DIR}/nfc_control.grpc.pb.cc
)

target_include_directories(nfc-control-proto PUBLIC ${PROTO_GEN_DIR})

target_link_libraries(nfc-control-proto
        gRPC::grpc++
        protobuf::libprotobuf
)

add_executable(test-rpc
        src/main/cpp/client.cpp
)

target_include_directories(test-rpc PRIVATE ${PRIVATE_SOURCE_DIR})

target_link_libraries(test-rpc
        ${PLATFORM_LIBS}
        nfc-control-proto
)
