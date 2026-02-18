import { getMethods, setMethods } from "./mof";

type MethodMap = typeof getMethods | typeof setMethods;
type MethodDefinition = MethodMap[string];

function expectMethodShape(
  methodName: string,
  method: MethodDefinition | undefined,
) {
  expect(method).toBeDefined();
  expect(method).toMatchObject({
    methodId: expect.any(String),
    methodName,
    description: expect.any(String),
    inArgs: expect.any(Array),
    outArgs: expect.any(Array),
  });

  for (const arg of method!.inArgs) {
    expect(arg).toMatchObject({
      description: expect.any(String),
      name: expect.any(String),
      type: expect.any(String),
    });
  }

  for (const arg of method!.outArgs) {
    expect(arg).toMatchObject({
      description: expect.any(String),
      name: expect.any(String),
      type: expect.any(String),
    });
  }
}

describe("mof parser output", () => {
  it("parses expected number of get and set methods", () => {
    expect(Object.keys(getMethods).length).toBe(71);
    expect(Object.keys(setMethods).length).toBe(66);
  });

  it("keeps method objects in expected shape", () => {
    for (const [methodName, method] of Object.entries(getMethods)) {
      expectMethodShape(methodName, method);
    }

    for (const [methodName, method] of Object.entries(setMethods)) {
      expectMethodShape(methodName, method);
    }
  });

  it("parses GetCPUFanDuty metadata and args", () => {
    const method = getMethods["GetCPUFanDuty"];

    expect(method).toBeDefined();
    expect(method!.methodId).toBe("70");
    expect(method!.methodName).toBe("GetCPUFanDuty");
    expect(method!.description).toBe("Get CPU Fan Duty");
    expect(method!.inArgs).toEqual([]);
    expect(method!.outArgs).toEqual([
      {
        description: "Data",
        type: "uint8",
        name: "Data",
      },
    ]);
  });

  it("parses inArgs for GetLightBar", () => {
    const method = getMethods["GetLightBar"];

    expect(method).toBeDefined();
    expect(method!.inArgs).toEqual([
      {
        description: "Index",
        type: "uint8",
        name: "Index",
      },
    ]);
    expect(method!.outArgs).toEqual([
      {
        description: "Status",
        type: "uint8",
        name: "Status",
      },
      {
        description: "Level",
        type: "uint8",
        name: "Level",
      },
      {
        description: "Red",
        type: "uint8",
        name: "Red",
      },
      {
        description: "Green",
        type: "uint8",
        name: "Green",
      },
      {
        description: "Blue",
        type: "uint8",
        name: "Blue",
      },
    ]);
  });

  it("parses SetFixedFanSpeed args for set methods", () => {
    const method = setMethods["SetFixedFanSpeed"];

    expect(method).toBeDefined();
    expect(method!.methodId).toBe("107");
    expect(method!.inArgs).toEqual([
      {
        description: "FixedFanSpeedData",
        type: "uint8",
        name: "Data",
      },
    ]);
    expect(method!.outArgs).toEqual([
      {
        description: "Data",
        type: "uint8",
        name: "DataOut",
      },
    ]);
  });

  it("sorts method names alphabetically", () => {
    const getMethodNames = Object.keys(getMethods);
    const setMethodNames = Object.keys(setMethods);

    expect(getMethodNames).toEqual([...getMethodNames].sort());
    expect(setMethodNames).toEqual([...setMethodNames].sort());
  });
});
