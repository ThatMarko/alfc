import React from "react";
import { ToggleState } from "../utils/enums";

type Props = {
  disabled?: boolean;
  label: string;
  name: string;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  value: ToggleState;
};

export function Toggle({
  disabled = false,
  label,
  name,
  onChange,
  value,
}: Props) {
  return (
    <label className="toggle">
      <input
        className="sr-only"
        disabled={disabled || value === ToggleState.Unknown}
        aria-label={label}
        type="checkbox"
        id={name}
        name={name}
        checked={value === ToggleState.On}
        onChange={onChange}
      />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  );
}
