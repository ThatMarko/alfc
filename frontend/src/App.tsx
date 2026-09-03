import styled from "@emotion/styled";
import { faExchangeAlt } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import React, { useEffect, useRef, useState } from "react";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { Button } from "reactstrap";
import { CPUTuning } from "./containers/CPUTuning";
import { FanTable } from "./containers/FanTable";
import { FixedSpeed } from "./containers/FixedSpeed";
import { RawUI } from "./containers/RawUI";
import { Toggles } from "./containers/Toggles";
import { useWebSocket } from "./utils/useWebSocket";
import { errorToast, successToast } from "./utils/misc";
import { UpdateNotification } from "./components/UpdateNotification";
const StyledTopRow = styled.div`
  display: flex;
  justify-content: center;
`;

const StyledChangeModeContainer = styled.div`
  align-self: center;

  display: flex;
  align-items: center;
  justify-content: center;

  margin: 8px;
`;

function App() {
  const [doFixedSpeed, setDoFixedSpeed] = useState(false);
  const isModeChangePending = useRef(false);

  const { isConnected, sendJsonMessage, lastJsonMessage } = useWebSocket();

  useEffect(() => {
    const { kind, data } = lastJsonMessage;
    if (kind === "state") {
      // Server confirmation: mode request settled.
      isModeChangePending.current = false;
      setDoFixedSpeed(data.doFixedSpeed);
    } else if (kind === "success") {
      // Only toast for config changes (no methodName).
      // WMI get/set responses have methodName and are handled by their own components.
      if (!lastJsonMessage.methodName) {
        successToast("Successfully applied.");
      }
    } else if (kind === "error") {
      if (isModeChangePending.current) {
        // Undo the optimistic toggle so the UI reflects rejected state.
        isModeChangePending.current = false;
        setDoFixedSpeed((current) => !current);
      }
      errorToast(
        typeof data === "string" ? data : "An unexpected error occurred.",
      );
      console.error(data);
    }
  }, [lastJsonMessage]);

  const onChangeMode: React.MouseEventHandler = () => {
    const nextValue = !doFixedSpeed;
    isModeChangePending.current = true;
    setDoFixedSpeed(nextValue);
    sendJsonMessage({ kind: "dofixedspeed", data: nextValue });
  };

  return (
    <>
      <div style={{ flexGrow: 1 }}>
        <StyledTopRow>
          <FanTable disabled={doFixedSpeed} />
          {isConnected && (
            <StyledChangeModeContainer>
              <Button
                onClick={onChangeMode}
                aria-label={
                  doFixedSpeed ? "Switch to auto mode" : "Switch to fixed mode"
                }
              >
                Auto
                <br />
                <FontAwesomeIcon icon={faExchangeAlt} aria-hidden="true" />
                <br />
                Fixed
              </Button>
            </StyledChangeModeContainer>
          )}
          <FixedSpeed disabled={!doFixedSpeed} />
        </StyledTopRow>
        <StyledTopRow>
          <div style={{ maxWidth: 300, marginLeft: 32, marginTop: 24 }}>
            <Toggles />
            <CPUTuning />
          </div>
        </StyledTopRow>
      </div>

      <RawUI />
      <ToastContainer />
      <UpdateNotification />
    </>
  );
}

export default App;
