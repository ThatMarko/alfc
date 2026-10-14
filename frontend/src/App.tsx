import styled from "@emotion/styled";
import { faExchangeAlt } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { MessageToServerKind } from "../../common/types";
import { ToastContainer } from "react-toastify/unstyled";
import "react-toastify/dist/ReactToastify.css";
import { CPUTuning } from "./containers/CPUTuning";
import { FanTable } from "./containers/FanTable";
import { FixedSpeed } from "./containers/FixedSpeed";
import { RawUI } from "./containers/RawUI";
import { Toggles } from "./containers/Toggles";
import { useBackendCommand, useWebSocket } from "./utils/useWebSocket";
import { UpdateNotification } from "./components/UpdateNotification";
const StyledTopRow = styled.div`
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
`;

const StyledChangeModeContainer = styled.div`
  align-self: center;

  display: flex;
  align-items: center;
  justify-content: center;

  margin: 8px;
`;

function App() {
  const { isConnected, state } = useWebSocket();
  const { isPending, runCommand } = useBackendCommand();
  const doFixedSpeed = state?.doFixedSpeed ?? false;
  const isFanControlAvailable = state?.isFanControlAvailable !== false;

  const onChangeMode = () => {
    if (!isConnected || !isFanControlAvailable || isPending) return;
    void runCommand({
      kind: MessageToServerKind.DoFixedSpeed,
      data: !doFixedSpeed,
    });
  };

  return (
    <>
      <div style={{ flexGrow: 1 }}>
        {state?.restartRequired === true && (
          <div
            role="alert"
            style={{ textAlign: "center", margin: 16, color: "#ffdda0" }}
          >
            A native service stopped responding. Restart ALFC to restore
            unavailable features.
          </div>
        )}
        {isConnected && !isFanControlAvailable && (
          <div
            role="alert"
            style={{ textAlign: "center", marginTop: 16, fontWeight: "bold" }}
          >
            Fan control is not available on this system.
          </div>
        )}
        <StyledTopRow>
          <FanTable
            disabled={!isFanControlAvailable || doFixedSpeed || isPending}
            statusDisabled={!isFanControlAvailable}
          />
          {isConnected && (
            <StyledChangeModeContainer>
              <button
                type="button"
                disabled={!isFanControlAvailable || isPending}
                onClick={onChangeMode}
                aria-label={
                  doFixedSpeed ? "Switch to auto mode" : "Switch to fixed mode"
                }
                aria-busy={isPending}
              >
                Auto
                <br />
                <FontAwesomeIcon icon={faExchangeAlt} aria-hidden="true" />
                <br />
                Fixed
              </button>
            </StyledChangeModeContainer>
          )}
          <FixedSpeed
            disabled={!isFanControlAvailable || !doFixedSpeed || isPending}
          />
        </StyledTopRow>
        <StyledTopRow>
          <div style={{ maxWidth: "100%", margin: 24 }}>
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
