import styled from "@emotion/styled";
import React, { useRef, useState } from "react";
import { MessageToServerKind } from "../../../common/types";
import { managedFanMethods } from "../../../common/methods";
import { getMethods, setMethods } from "../data/mof";
import { theme } from "../utils/consts";
import { parseIntegerInRange, validationToast } from "../utils/misc";
import { useBackendCommand, useWebSocket } from "../utils/useWebSocket";

const Kind = {
  Get: MessageToServerKind.Get,
  Set: MessageToServerKind.Set,
} as const;
type Kind = (typeof Kind)[keyof typeof Kind];
const argumentMaximum = (type: string) =>
  type === "uint16" ? 65535 : type === "uint32" ? 4294967295 : 255;

const StyledHeader = styled.button`
  width: 100%;
  margin: 32px 0 0 0;
  padding: 8px;

  background-color: ${theme.secondary};

  color: inherit;
  font-size: inherit;
  font-weight: inherit;
  letter-spacing: inherit;
  text-align: left;
  border-radius: 0;

  cursor: pointer;
`;

const StyledContent = styled.div`
  font-size: 14px;
`;

const StyledControls = styled.div`
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  padding: 8px;

  > * {
    min-width: 0;
    max-width: 100%;
  }
`;

const StyledForm = styled.form`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  max-width: 100%;

  > * {
    min-width: 0;
    max-width: 100%;
  }
`;

export function RawUI() {
  const refRun = useRef<HTMLButtonElement>(null);

  const [kind, setKind] = useState<Kind>(Kind.Get);
  const [methodName, setMethodName] = useState("");
  const [args, setArgs] = useState<{ [key: string]: string }>({});
  const [isVisible, setIsVisible] = useState(false);
  const [result, setResult] = useState("");

  const { isConnected, state } = useWebSocket();
  const { isPending: isRunning, runCommand } = useBackendCommand();

  if (!isConnected) {
    return null;
  }

  const onKindChange: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    setKind(event.target.value as Kind);
    setMethodName("");
    setArgs({});
  };

  const methods = kind === Kind.Get ? getMethods : setMethods;
  const selectedMethod = methodName !== "" ? methods[methodName] : undefined;

  const isManaged = kind === Kind.Set && managedFanMethods.has(methodName);
  const isUnavailableBoost =
    kind === Kind.Set &&
    methodName === "SetAIBoostStatus" &&
    state?.isGpuBoostAvailable === false;

  const onSubmit: React.FormEventHandler = (event) => {
    event.preventDefault();
    refRun.current?.focus();
    if (!selectedMethod || isRunning || isManaged || isUnavailableBoost) return;
    const parsedArgs: { [key: string]: number } = {};
    for (const arg of selectedMethod.inArgs) {
      const parsed = parseIntegerInRange(
        args[arg.name] ?? "",
        0,
        argumentMaximum(arg.type),
      );
      if (parsed === null) {
        validationToast(
          `Argument ${arg.name} must be a whole number from 0 to ${argumentMaximum(arg.type)}.`,
        );
        return;
      }
      parsedArgs[arg.name] = parsed;
    }
    void runCommand(
      {
        kind,
        methodId: selectedMethod.methodId,
        methodName,
        data: parsedArgs,
      },
      false,
    ).then((response) => {
      const data = response?.data;
      const display = !response
        ? "Request failed; see the error notification."
        : data === undefined
          ? "OK"
          : typeof data === "number"
            ? `${data} (0x${data.toString(16)})`
            : typeof data === "string" && /^\d+$/.test(data)
              ? `${data} (0x${BigInt(data).toString(16)})`
              : typeof data === "string"
                ? data
                : JSON.stringify(data);
      setResult(`${new Date().toLocaleTimeString()}: ${display}`);
    });
  };

  const methodNameOptions = Object.keys(methods).map((name) => (
    <option key={name} value={name}>
      {name}
    </option>
  ));
  const argumentsComponent =
    !selectedMethod || selectedMethod.inArgs.length === 0 ? null : (
      <div>
        Arguments:
        {selectedMethod.inArgs.map((arg) => (
          <div key={arg.name}>
            <label>
              <em>{arg.type}</em> {arg.name} ({arg.description})
              <input
                type="number"
                min={0}
                max={argumentMaximum(arg.type)}
                required
                step={1}
                disabled={isRunning}
                aria-label={`Argument ${arg.name}`}
                onChange={(event) => {
                  setArgs((prev) => ({
                    ...prev,
                    [arg.name]: event.target.value,
                  }));
                }}
                value={args[arg.name] ?? ""}
              />
            </label>
          </div>
        ))}
      </div>
    );

  const isRunnable =
    !isManaged &&
    !isUnavailableBoost &&
    selectedMethod !== undefined &&
    selectedMethod.inArgs.every(
      (arg) =>
        parseIntegerInRange(
          args[arg.name] ?? "",
          0,
          argumentMaximum(arg.type),
        ) !== null,
    );

  const content = isVisible && (
    <StyledContent id="raw-ui-content">
      <div style={{ margin: 8 }}>
        Advanced hardware commands. Availability depends on the laptop and
        operating system. Use the fan controls above for managed fan settings.
      </div>
      {isManaged && (
        <p role="status" style={{ margin: 8 }}>
          This fan setting is managed by the backend. Use automatic mode, fixed
          speed, or the fan curve editor above.
        </p>
      )}
      {isUnavailableBoost && (
        <p role="status" style={{ margin: 8 }}>
          GPU boost is not available on this system.
        </p>
      )}
      <StyledControls>
        <StyledForm onSubmit={onSubmit}>
          <div>
            <label>
              <input
                type="radio"
                name="kind"
                value={Kind.Get}
                checked={kind === Kind.Get}
                onChange={onKindChange}
                disabled={isRunning}
              />
              Get
            </label>
            <br />
            <label>
              <input
                type="radio"
                name="kind"
                value={Kind.Set}
                checked={kind === Kind.Set}
                onChange={onKindChange}
                disabled={isRunning}
              />
              Set
            </label>
          </div>
          <select
            name="methodName"
            aria-label="WMI method name"
            size={10}
            disabled={isRunning}
            style={{ maxWidth: "100%" }}
            value={methodName}
            onChange={(event) => {
              setArgs({});
              setMethodName(event.target.value);
            }}
          >
            <option value="" disabled>
              Select a method
            </option>
            {methodNameOptions}
          </select>
          {argumentsComponent}
          <div>
            {selectedMethod &&
              selectedMethod.outArgs.length > 0 &&
              selectedMethod.outArgs[0]?.type === "uint16" && (
                <div style={{ marginLeft: 4 }}>
                  uint16 output =&gt; little endian!
                </div>
              )}
            <button
              disabled={!isRunnable || isRunning}
              type="submit"
              ref={refRun}
            >
              Run
            </button>
          </div>
        </StyledForm>
        <div>
          <label>
            Output
            <br />
            <textarea
              readOnly
              aria-label="WMI command output"
              rows={4}
              cols={40}
              value={result}
              style={{ maxWidth: "100%" }}
            />
          </label>
        </div>
      </StyledControls>
    </StyledContent>
  );

  return (
    <div>
      <StyledHeader
        type="button"
        aria-label="Toggle Raw UI"
        onClick={() => setIsVisible(!isVisible)}
        aria-expanded={isVisible}
        aria-controls="raw-ui-content"
      >
        Raw UI
      </StyledHeader>
      {content}
    </div>
  );
}
