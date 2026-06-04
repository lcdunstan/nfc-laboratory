#include <iostream>
#include <fstream>
#include <cmath>
#include <vector>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

constexpr float EPSILON = 1e-4f;

inline float iqToMagnitudeSample(int16_t i, int16_t q) {
    float fi = (static_cast<float>(i) - 2048.0f) / 2048.0f;
    float fq = (static_cast<float>(q) - 2048.0f) / 2048.0f;
    return std::sqrt(fi * fi + fq * fq);
}

std::vector<float> iqToMagnitude(const int16_t* iq, int pairCount) {
    std::vector<float> mag(pairCount);
    for (int i = 0; i < pairCount; i++) {
        mag[i] = iqToMagnitudeSample(iq[i * 2], iq[i * 2 + 1]);
    }
    return mag;
}

struct TestVector {
    std::string name;
    std::vector<int16_t> iq;
    std::vector<float> expected;
    int pairCount;
};

bool runTest(const TestVector& tv, int& failures) {
    auto result = iqToMagnitude(tv.iq.data(), tv.pairCount);
    bool ok = true;

    for (int i = 0; i < tv.pairCount; i++) {
        float diff = std::abs(result[i] - tv.expected[i]);
        if (diff > EPSILON) {
            std::cout << "  FAIL [" << tv.name << "][" << i << "]: "
                      << "got " << result[i] << ", expected " << tv.expected[i]
                      << " (diff " << diff << ")\n";
            ok = false;
            failures++;
        }
    }

    if (ok) {
        std::cout << "  PASS [" << tv.name << "]\n";
    }

    return ok;
}

int main(int argc, char* argv[]) {
    std::vector<TestVector> vectors;

    if (argc > 1) {
        std::ifstream file(argv[1]);
        if (!file.is_open()) {
            std::cerr << "Failed to open: " << argv[1] << "\n";
            return 1;
        }

        json root;
        file >> root;

        for (const auto& v : root["vectors"]) {
            TestVector tv;
            tv.name = v["name"];
            tv.pairCount = v["iq"].size() / 2;
            for (auto val : v["iq"]) tv.iq.push_back(static_cast<int16_t>(val));
            for (auto val : v["mag"]) tv.expected.push_back(static_cast<float>(val));
            vectors.push_back(tv);
        }
    } else {
        vectors = {
            {"dc_zero",    {2048, 2048, 2048, 2048}, {0.0f, 0.0f}, 2},
            {"max_iq",     {4095, 4095},             {1.4135f},     1},
            {"min_iq",     {0, 0},                   {1.4142f},     1},
            {"i_only_pos", {4095, 2048},             {0.9995f},     1},
            {"i_only_neg", {0, 2048},                {1.0f},        1},
            {"q_only_pos", {2048, 4095},             {0.9995f},     1},
            {"mid_range",  {3072, 3072},             {0.7071f},     1},
            {"mixed",      {3072, 2048, 2048, 1024}, {0.5f, 0.5f},  2},
            {"alternating", {4095, 0, 0, 4095, 2048, 2048, 1024, 3072},
                            {1.4139f, 1.4139f, 0.0f, 0.7071f}, 4},
        };
    }

    int total = 0;
    int failures = 0;

    for (auto& v : vectors) {
        total++;
        runTest(v, failures);
    }

    std::cout << "\n" << total << " tests, " << failures << " failures\n";
    return failures > 0 ? 1 : 0;
}
