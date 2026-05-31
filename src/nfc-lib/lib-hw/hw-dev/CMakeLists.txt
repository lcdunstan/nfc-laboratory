set(CMAKE_CXX_STANDARD 17)

set(PRIVATE_SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp)
set(PUBLIC_INCLUDE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/src/main/include)

add_library(hw-dev STATIC
        ${PRIVATE_SOURCE_DIR}/usb/Usb.cpp)

target_include_directories(hw-dev PUBLIC ${PUBLIC_INCLUDE_DIR})
target_include_directories(hw-dev PRIVATE ${PRIVATE_SOURCE_DIR})
target_include_directories(hw-dev PRIVATE ${LIBUSB_INCLUDE_DIRS})

target_link_libraries(hw-dev hw-core ${LIBUSB_LIBRARIES})
