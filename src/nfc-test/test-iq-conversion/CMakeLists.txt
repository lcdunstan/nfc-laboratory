set(CMAKE_CXX_STANDARD 17)

add_executable(test-iq-conversion
        src/main/cpp/main.cpp
)

target_link_libraries(test-iq-conversion nlohmann)
