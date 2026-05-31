set(CMAKE_CXX_STANDARD 17)

set(PRIVATE_SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp)
set(PUBLIC_INCLUDE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/src/main/include)

# Hardware-dependent task files (not available on Emscripten/WASM)
if(EMSCRIPTEN)
    set(HW_TASK_SOURCES "")
else()
    set(HW_TASK_SOURCES
        ${PRIVATE_SOURCE_DIR}/tasks/RadioDeviceTask.cpp
        ${PRIVATE_SOURCE_DIR}/tasks/LogicDeviceTask.cpp)
endif()

add_library(lab-tasks STATIC
        ${PRIVATE_SOURCE_DIR}/tasks/FourierProcessTask.cpp
        ${PRIVATE_SOURCE_DIR}/tasks/LogicDecoderTask.cpp
        ${PRIVATE_SOURCE_DIR}/tasks/RadioDecoderTask.cpp
        ${PRIVATE_SOURCE_DIR}/tasks/SignalStreamTask.cpp
        ${PRIVATE_SOURCE_DIR}/tasks/SignalStorageTask.cpp
        ${PRIVATE_SOURCE_DIR}/tasks/TraceStorageTask.cpp
        ${HW_TASK_SOURCES}
        )

if (CMAKE_SYSTEM_PROCESSOR MATCHES "(x86)|(X86)|(amd64)|(AMD64)" AND NOT EMSCRIPTEN)
    target_compile_options(lab-tasks PRIVATE "-msse2" -DUSE_SSE2)
endif ()

target_include_directories(lab-tasks PUBLIC ${PUBLIC_INCLUDE_DIR})
target_include_directories(lab-tasks PRIVATE ${PRIVATE_SOURCE_DIR})

if(EMSCRIPTEN)
    target_link_libraries(lab-tasks PUBLIC lab-logic lab-radio)
    target_link_libraries(lab-tasks PRIVATE rt-lang hw-core nlohmann microtar z)
else()
    target_link_libraries(lab-tasks PUBLIC lab-logic lab-radio)
    target_link_libraries(lab-tasks PRIVATE rt-lang hw-core hw-radio hw-logic nlohmann microtar z)
endif()