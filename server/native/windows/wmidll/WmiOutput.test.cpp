#include "WmiOutput.h"
#include <cassert>
#include <cstdio>

int main() {
    double output[16] = {};
    int count = -1;

    // Property enumeration order can differ from method parameter ID order.
    WmiOutputField lightBar[] = {{5, 50, 1}, {4, 40, 1}, {2, 20, 1}, {3, 30, 1}, {1, 10, 1}};
    assert(PackWmiOutputFields(lightBar, 5, output, 16, &count) == nullptr);
    assert(count == 5);
    for (int i = 0; i < 5; i++) assert(output[i] == (i + 1) * 10);

    // A uint16 below 256 must retain its zero high byte before later fields.
    WmiOutputField mixed[] = {{2, 0x34, 1}, {1, 0x12, 2}, {0, 0x56, 1}};
    assert(PackWmiOutputFields(mixed, 3, output, 16, &count) == nullptr);
    assert(count == 4 && output[0] == 0x56 && output[1] == 0x12 && output[2] == 0 && output[3] == 0x34);

    WmiOutputField rpm[] = {{0, 3000, 2}};
    assert(PackWmiOutputFields(rpm, 1, output, 16, &count) == nullptr);
    assert(count == 2 && output[0] == 0xb8 && output[1] == 0x0b);

    WmiOutputField zero[] = {{-1, 0, 2}};
    assert(PackWmiOutputFields(zero, 1, output, 16, &count) == nullptr);
    assert(count == 2 && output[0] == 0 && output[1] == 0);

    WmiOutputField deepFan[10];
    for (int i = 0; i < 10; i++) deepFan[i] = {9 - i, static_cast<unsigned int>(i), 1};
    assert(PackWmiOutputFields(deepFan, 10, output, 16, &count) == nullptr);
    assert(count == 10);
    for (int i = 0; i < 10; i++) assert(output[i] == 9 - i);

    WmiOutputField duplicate[] = {{0, 1, 1}, {0, 2, 1}};
    WmiOutputField missing[] = {{-1, 1, 1}, {1, 2, 1}};
    WmiOutputField oversized[] = {{0, 1, 2}, {1, 2, 2}};
    WmiOutputField badWidth[] = {{0, 1, 4}};
    WmiOutputField badByte[] = {{0, 256, 1}};
    WmiOutputField badWord[] = {{0, 65536, 2}};
    output[0] = 99;
    assert(PackWmiOutputFields(duplicate, 2, output, 16, &count) != nullptr && count == 0);
    assert(PackWmiOutputFields(missing, 2, output, 16, &count) != nullptr && count == 0);
    assert(PackWmiOutputFields(oversized, 2, output, 3, &count) != nullptr && count == 0);
    assert(PackWmiOutputFields(badWidth, 1, output, 16, &count) != nullptr && count == 0);
    assert(PackWmiOutputFields(badByte, 1, output, 16, &count) != nullptr && count == 0);
    assert(PackWmiOutputFields(badWord, 1, output, 16, &count) != nullptr && count == 0);
    assert(PackWmiOutputFields(rpm, 0, output, 16, &count) != nullptr && count == 0);
    assert(PackWmiOutputFields(rpm, 17, output, 16, &count) != nullptr && count == 0);
    assert(output[0] == 99);
    std::puts("WMI output packing checks passed");
}
