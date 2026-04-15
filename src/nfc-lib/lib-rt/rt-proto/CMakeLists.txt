set(CMAKE_CXX_STANDARD 17)

set(PROTO_GENERATED_DIR ${CMAKE_CURRENT_BINARY_DIR}/generated)
file(MAKE_DIRECTORY ${PROTO_GENERATED_DIR})

file(GLOB PROTO_FILES ${CMAKE_CURRENT_SOURCE_DIR}/src/main/proto/*.proto)

set(PROTO_SRCS)
set(PROTO_HDRS)

foreach(PROTO_FILE ${PROTO_FILES})
    get_filename_component(PROTO_NAME ${PROTO_FILE} NAME_WE)
    list(APPEND PROTO_SRCS ${PROTO_GENERATED_DIR}/${PROTO_NAME}.pb.cc)
    list(APPEND PROTO_HDRS ${PROTO_GENERATED_DIR}/${PROTO_NAME}.pb.h)

    add_custom_command(
        OUTPUT  ${PROTO_GENERATED_DIR}/${PROTO_NAME}.pb.cc
                ${PROTO_GENERATED_DIR}/${PROTO_NAME}.pb.h
        COMMAND protobuf::protoc
            --cpp_out=${PROTO_GENERATED_DIR}
            --proto_path=${CMAKE_CURRENT_SOURCE_DIR}/src/main/proto
            ${PROTO_FILE}
        DEPENDS ${PROTO_FILE} protobuf::protoc
        COMMENT "Generating C++ from ${PROTO_NAME}.proto"
    )
endforeach()

add_library(rt-proto STATIC ${PROTO_SRCS} ${PROTO_HDRS})

target_include_directories(rt-proto PUBLIC ${PROTO_GENERATED_DIR})

target_link_libraries(rt-proto PUBLIC protobuf::libprotobuf)

set_target_properties(rt-proto PROPERTIES POSITION_INDEPENDENT_CODE ON)

# Optional verification executable: cmake -DRT_PROTO_BUILD_VERIFY=ON
option(RT_PROTO_BUILD_VERIFY "Build rt-proto verification target" OFF)

if(RT_PROTO_BUILD_VERIFY)
    add_executable(rt-proto-verify src/test/cpp/verify_proto.cpp)
    target_link_libraries(rt-proto-verify rt-proto)
    set_target_properties(rt-proto-verify PROPERTIES CXX_STANDARD 17)
endif()
