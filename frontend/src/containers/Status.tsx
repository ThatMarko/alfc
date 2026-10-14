import { faInfoCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useRef } from "react";
import { SimpleTooltip } from "../components/SimpleTooltip";
import { StyledArea } from "../components/StyledArea";
import { useWebSocket } from "../utils/useWebSocket";

export function Status({ disabled }: { disabled: boolean }) {
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const { isConnected, activity, isActivityStale } = useWebSocket();
  if (!isConnected) return null;
  const readings = disabled ? null : activity;
  const sensorFailure = readings?.sensorFailure === true;
  const telemetryStale = readings !== null && isActivityStale;
  const status = `${telemetryStale ? "Telemetry is stale — showing last received readings\n" : ""}${sensorFailure ? "Sensor error — showing last known readings\n" : ""}CPU: ${readings ? Math.round(readings.avgCPUTemp) : "-"}°C
GPU: ${readings ? Math.round(readings.avgGPUTemp) : "-"}°C
Current target: ${readings?.target ?? "-"}%
Last applied: ${readings?.appliedSpeed ?? "-"}%`;

  return (
    <StyledArea>
      <h2>
        Status{" "}
        <span
          ref={tooltipRef}
          tabIndex={0}
          aria-label="About fan control status"
        >
          <FontAwesomeIcon icon={faInfoCircle} />
        </span>
        <SimpleTooltip target={tooltipRef}>
          Both fans use the same target speed. The higher of the CPU and GPU
          fan-curve targets wins. Fixed mode continues to report temperature and
          applied speed.
        </SimpleTooltip>
      </h2>
      {telemetryStale && (
        <p role="alert">
          Telemetry is stale. The backend has not sent readings for 10 seconds.
        </p>
      )}
      {sensorFailure && (
        <p role="alert">
          Temperature readings are stale. The backend is applying its sensor
          failure fan policy.
        </p>
      )}
      <textarea
        readOnly
        aria-label="Fan control status"
        value={status}
        rows={4 + Number(sensorFailure) + Number(telemetryStale)}
        cols={sensorFailure ? 44 : 25}
        style={{ fontSize: 14, cursor: "default", maxWidth: "100%" }}
      />
    </StyledArea>
  );
}
