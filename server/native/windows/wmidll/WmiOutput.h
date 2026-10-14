#ifndef ALFC_WMI_OUTPUT_H
#define ALFC_WMI_OUTPUT_H

// No Windows dependencies: packing can be checked on every CI platform.
struct WmiOutputField {
    int order;
    unsigned int value;
    int width;
};

// The caller owns the field array; sorting it never changes external WMI
// objects. No output is written unless every field is valid and fits.
static inline const char *PackWmiOutputFields(
    WmiOutputField *fields, int fieldCount,
    double *output, int capacity, int *outputCount
) {
    if (!outputCount) return "Missing output count";
    *outputCount = 0;
    if (!fields || !output || fieldCount < 1 || capacity < 1 || fieldCount > capacity) {
        return "Invalid output field count";
    }
    int byteCount = 0;
    for (int i = 0; i < fieldCount; i++) {
        if ((fields[i].width != 1 && fields[i].width != 2) ||
            fields[i].value > (fields[i].width == 1 ? 0xffu : 0xffffu)) {
            return "Invalid output width or value";
        }
        if (fields[i].width > capacity - byteCount) return "Output exceeds buffer capacity";
        byteCount += fields[i].width;
        if (fieldCount > 1 && fields[i].order < 0) return "Missing parameter ID";
        for (int j = 0; j < i; j++) {
            if (fields[i].order == fields[j].order) return "Duplicate parameter ID";
        }
    }
    for (int i = 1; i < fieldCount; i++) {
        WmiOutputField field = fields[i];
        int j = i;
        while (j > 0 && fields[j - 1].order > field.order) {
            fields[j] = fields[j - 1];
            j--;
        }
        fields[j] = field;
    }
    int count = 0;
    for (int i = 0; i < fieldCount; i++) {
        output[count++] = fields[i].value & 0xff;
        if (fields[i].width == 2) output[count++] = (fields[i].value >> 8) & 0xff;
    }
    *outputCount = count;
    return nullptr;
}

#endif
