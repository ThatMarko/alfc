const { mockSuccess, mockError } = vi.hoisted(() => ({
  mockSuccess: vi.fn(),
  mockError: vi.fn(),
}));

vi.mock("react-toastify", () => ({
  toast: {
    success: mockSuccess,
    error: mockError,
  },
}));

import { theme } from "./consts";
import { errorToast, successToast } from "./misc";

describe("toast utility wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls toast.success with expected options", () => {
    successToast("Saved");

    expect(mockSuccess).toHaveBeenCalledTimes(1);
    expect(mockError).not.toHaveBeenCalled();
    expect(mockSuccess).toHaveBeenCalledWith("Saved", {
      theme: "colored",
      autoClose: 5000,
      position: "bottom-right",
      style: {
        background: theme.primary,
      },
    });
  });

  it("calls toast.error with expected options", () => {
    errorToast("Failed");

    expect(mockError).toHaveBeenCalledTimes(1);
    expect(mockSuccess).not.toHaveBeenCalled();
    expect(mockError).toHaveBeenCalledWith("Failed", {
      theme: "colored",
      position: "bottom-right",
      autoClose: false,
    });
  });
});
