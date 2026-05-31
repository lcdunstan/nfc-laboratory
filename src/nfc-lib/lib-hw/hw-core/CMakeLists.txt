set(CMAKE_CXX_STANDARD 17)

set(PRIVATE_SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp)
set(PUBLIC_INCLUDE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/src/main/include)

add_library(hw-core STATIC
        ${PRIVATE_SOURCE_DIR}/hw/SignalBuffer.cpp
        ${PRIVATE_SOURCE_DIR}/hw/RecordDevice.cpp
        ${PRIVATE_SOURCE_DIR}/hw/DeviceFactory.cpp)

target_include_directories(hw-core PUBLIC ${PUBLIC_INCLUDE_DIR})
target_include_directories(hw-core PRIVATE ${PRIVATE_SOURCE_DIR})

target_link_libraries(hw-core rt-lang)
