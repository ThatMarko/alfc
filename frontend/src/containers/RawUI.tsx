import styled from "@emotion/styled";
import React, { useEffect, useRef, useState } from "react";
import { getMethods, setMethods } from "../data/mof";
import { theme } from "../utils/consts";
import {
  nextRequestId,
  parseIntegerInRange,
  validationToast,
} from "../utils/misc";
import { useWebSocket } from "../utils/useWebSocket";

enum Kind {
  Get = "get",
  Set = "set",
}

const StyledHeader = styled.button`
  width: 100%;
  margin-top: 32px;
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
  padding: 8px;
`;

const StyledForm = styled.form`
  display: flex;
  align-items: center;
`;

export function RawUI() {
  const refRun = useRef<HTMLButtonElement>(null);
  const pendingRequestIdRef = useRef<string | null>(null);

  const [kind, setKind] = useState(Kind.Get);
  const [methodName, setMethodName] = useState("");
  const [args, setArgs] = useState<{ [key: string]: string }>({});
  const [isRunning, setIsRunning] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [result, setResult] = useState("");

  const { isConnected, sendJsonMessage, lastJsonMessage } = useWebSocket();

  useEffect(() => {
    const { data, requestId } = lastJsonMessage;
    // Only the response to our own Run matters here: server pushes
    // (state, fancontrolactivity) never carry a requestId, and other
    // requests echo their own id — even when they reuse the same WMI
    // opcode (e.g. the GPU Boost toggle and SetAIBoostStatus).
    if (
      pendingRequestIdRef.current === null ||
      requestId !== pendingRequestIdRef.current
    ) {
      return;
    }
    pendingRequestIdRef.current = null;
    setIsRunning(false);
    if (data !== undefined) {
      const display =
        typeof data === "number"
          ? `${data} (0x${data.toString(16)})`
          : String(data);
      setResult(`${new Date().toLocaleTimeString()}: ${display}`);
    }
  }, [lastJsonMessage]);

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

  const onSubmit: React.FormEventHandler = (event) => {
    event.preventDefault();
    refRun.current?.focus();
    if (!selectedMethod) return;
    const parsedArgs: { [key: string]: number } = {};
    for (const arg of selectedMethod.inArgs) {
      const parsed = parseIntegerInRange(args[arg.name] ?? "", 0, 255);
      if (parsed === null) {
        validationToast(
          `Argument ${arg.name} must be a whole number from 0 to 255.`,
        );
        return;
      }
      parsedArgs[arg.name] = parsed;
    }
    const requestId = nextRequestId("rawui");
    pendingRequestIdRef.current = requestId;
    setIsRunning(true);
    sendJsonMessage({
      kind,
      methodId: selectedMethod.methodId,
      methodName,
      requestId,
      data: selectedMethod.inArgs.length > 0 ? parsedArgs : undefined,
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
                max={255}
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
    selectedMethod !== undefined &&
    selectedMethod.inArgs.every(
      (arg) => parseIntegerInRange(args[arg.name] ?? "", 0, 255) !== null,
    );

  const content = isVisible && (
    <StyledContent id="raw-ui-content">
      <div style={{ margin: 8 }}>
        ⚠️ It goes without saying that you should know what you&apos;re doing
        when using this.
        <br />
        Some of these simply won&apos;t work probably because these commands are
        used on many different laptops and the Aorus 15G doesn&apos;t have
        implementations for all of them.
      </div>
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
              />
              Set
            </label>
          </div>
          <select
            name="methodName"
            aria-label="WMI method name"
            size={10}
            onChange={(event) => {
              setArgs({});
              setMethodName(event.target.value);
            }}
          >
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
