import { MessageToServerKind } from "../../common/types";
import { CPUTuning } from "./containers/CPUTuning";
import { FanTable } from "./containers/FanTable";
import { FixedSpeed } from "./containers/FixedSpeed";
import { RawUI } from "./containers/RawUI";
import { Toggles } from "./containers/Toggles";
import { Status } from "./containers/Status";
import { useBackendCommand, useWebSocket } from "./utils/useWebSocket";
import { UpdateNotification } from "./components/UpdateNotification";

function App() {
  const { isConnected, state } = useWebSocket();
  const { isPending, runCommand } = useBackendCommand();
  const doFixedSpeed = state?.doFixedSpeed ?? false;
  const isFanControlAvailable = state?.isFanControlAvailable !== false;
  const disabled = !isConnected || !isFanControlAvailable || isPending;

  const changeMode = (fixed: boolean) => {
    if (disabled || fixed === doFixedSpeed) return;
    void runCommand({ kind: MessageToServerKind.DoFixedSpeed, data: fixed });
  };

  return (
    <>
      <div className="page-intro">
        <div>
          <h1>Cooling &amp; performance</h1>
          <p>Live readings and confirmed settings from your laptop.</p>
        </div>
      </div>
      {state?.restartRequired === true && (
        <div className="notice error" role="alert">
          A native service stopped responding. Restart ALFC to restore
          unavailable features.
        </div>
      )}
      {!isFanControlAvailable && (
        <div className="notice" role="alert">
          Fan control is not available on this system.
        </div>
      )}
      <div className="dashboard">
        <Status disabled={!isFanControlAvailable} />
        <section className="panel" aria-label="Fan control mode">
          <div className="panel-header">
            <h2>Fan control</h2>
            <span className="status-pill" aria-label="Current fan mode">
              {doFixedSpeed ? "Fixed speed" : "Automatic"}
            </span>
          </div>
          <p className="section-description">
            Choose how ALFC sets the shared target for both fans.
          </p>
          <div className="mode-options">
            <button
              type="button"
              aria-label="Switch to auto mode"
              aria-pressed={!doFixedSpeed}
              disabled={disabled || !doFixedSpeed}
              onClick={() => changeMode(false)}
            >
              Automatic
            </button>
            <button
              type="button"
              aria-label="Switch to fixed mode"
              aria-pressed={doFixedSpeed}
              disabled={disabled || doFixedSpeed}
              onClick={() => changeMode(true)}
            >
              Fixed speed
            </button>
          </div>
          <p
            className="mode-description"
            role={isPending ? "status" : undefined}
          >
            {isPending
              ? "Confirming the mode change…"
              : doFixedSpeed
                ? "Fixed mode uses the saved " +
                  (state?.fixedPercentage ?? 0) +
                  "% preset."
                : "Automatic mode follows the saved CPU and GPU fan curves."}
          </p>
          {!isPending && isFanControlAvailable && (
            <a
              className="setting-shortcut"
              href={
                doFixedSpeed ? "#fixed-speed-preset" : "#automatic-fan-curves"
              }
            >
              {doFixedSpeed ? "Edit fixed preset" : "Edit fan curves"}
            </a>
          )}
        </section>
        <div className="settings-grid">
          <FanTable disabled={disabled} />
          <div className="settings-side">
            <FixedSpeed disabled={disabled} />
            <CPUTuning />
            <Toggles />
          </div>
        </div>
        <RawUI />
      </div>
      <footer className="app-footer">
        Settings change after the server accepts them. Applied fan commands are
        shown separately from configured targets.
      </footer>
      <UpdateNotification />
    </>
  );
}

export default App;
