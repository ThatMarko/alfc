import { InfoTooltip } from "../components/InfoTooltip";
import { useWebSocket } from "../utils/useWebSocket";

export function Status({ disabled }: { disabled: boolean }) {
  const { isConnected, activity, isActivityStale } = useWebSocket();
  const readings = disabled ? null : activity;
  const sensorFailure = readings?.sensorFailure === true;
  const telemetryStale = !disabled && isConnected && isActivityStale;
  const unconfirmed = readings !== null && readings.appliedSpeed === null;
  const status = !isConnected
    ? "Offline"
    : disabled
      ? "Unavailable"
      : telemetryStale
        ? "Stale"
        : sensorFailure
          ? "Sensor error"
          : readings
            ? "Live"
            : "Waiting for readings";

  return (
    <section className="panel" aria-label="Fan control status">
      <div className="panel-header status-heading">
        <h2>
          Live telemetry{" "}
          <InfoTooltip label="About fan control status">
            Both fans use the same target speed. The higher of the CPU and GPU
            fan-curve targets wins. Fixed mode continues to report temperature
            and applied speed. Applied speed confirms the last accepted command;
            fan RPM is not measured here.
          </InfoTooltip>
        </h2>
        <span className="status-pill">{status}</span>
      </div>
      <dl className="metrics" style={{ margin: 0 }}>
        <div className="metric">
          <dt>CPU temperature</dt>
          <dd>
            {readings ? Math.round(readings.avgCPUTemp) : "—"}
            <small>°C</small>
          </dd>
        </div>
        <div className="metric">
          <dt>GPU temperature</dt>
          <dd>
            {readings ? Math.round(readings.avgGPUTemp) : "—"}
            <small>°C</small>
          </dd>
        </div>
        <div className="metric">
          <dt>Current target</dt>
          <dd>
            {readings?.target ?? "—"}
            <small>%</small>
          </dd>
        </div>
        <div className="metric">
          <dt>Last applied command</dt>
          <dd data-unconfirmed={unconfirmed}>
            {unconfirmed ? "Unconfirmed" : (readings?.appliedSpeed ?? "—")}
            {!unconfirmed && <small>%</small>}
          </dd>
        </div>
      </dl>
      {telemetryStale && (
        <p className="telemetry-notice" role="alert">
          Telemetry is stale. The backend has not sent readings for 10 seconds.{" "}
          {readings
            ? "Showing last received readings."
            : "No readings have been received on this connection."}
        </p>
      )}
      {sensorFailure && (
        <p className="telemetry-notice" role="alert">
          Sensor error. Temperature readings are stale. The backend is applying
          its sensor failure fan policy.
        </p>
      )}
      {unconfirmed && (
        <p className="telemetry-notice" role="alert">
          The latest fan write could not be confirmed. The target is not a
          confirmed applied speed.
        </p>
      )}
      {!readings && !telemetryStale && (
        <p className="metric-note">
          {disabled
            ? "Temperature and fan-control readings are unavailable on this system."
            : !isConnected
              ? "Live readings will resume after reconnection."
              : "Waiting for the first temperature and fan-control readings."}
        </p>
      )}
    </section>
  );
}
