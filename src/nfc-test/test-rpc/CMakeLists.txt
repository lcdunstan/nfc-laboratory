set(CMAKE_CXX_STANDARD 17)

find_package(Protobuf CONFIG REQUIRED)
find_package(gRPC CONFIG REQUIRED)

set(PRIVATE_SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp)
set(PROTO_DIR          ${CMAKE_CURRENT_SOURCE_DIR}/src/main/proto)
set(PROTO_FILE         ${PROTO_DIR}/nfc_capture.proto)
set(PROTO_GEN_DIR      ${CMAKE_CURRENT_BINARY_DIR})

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

add_executable(test-rpc
        src/main/cpp/main.cpp
        ${PROTO_GEN_DIR}/nfc_capture.pb.cc
        ${PROTO_GEN_DIR}/nfc_capture.grpc.pb.cc
)

target_include_directories(test-rpc PRIVATE
        ${PRIVATE_SOURCE_DIR}
        ${PROTO_GEN_DIR}
)

if (WIN32)
    set(PLATFORM_LIBS mingw32 psapi)
endif ()

target_link_libraries(test-rpc
        ${PLATFORM_LIBS}
        gRPC::grpc++
        protobuf::libprotobuf
)