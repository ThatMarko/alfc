import styled from "@emotion/styled";
import { faInfoCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useId, useRef, type ReactNode } from "react";
import { SimpleTooltip } from "./SimpleTooltip";

const StyledInfoButton = styled.button`
  display: inline-flex;
  align-items: center;
  padding: 2px;
  margin: 0;
  background: transparent;
  color: inherit;
  cursor: help;
`;

export function InfoTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const target = useRef<HTMLButtonElement>(null);
  const id = useId();
  return (
    <>
      <StyledInfoButton
        type="button"
        ref={target}
        aria-label={label}
        aria-describedby={id}
      >
        <FontAwesomeIcon icon={faInfoCircle} aria-hidden="true" />
      </StyledInfoButton>
      <SimpleTooltip id={id} target={target}>
        {children}
      </SimpleTooltip>
    </>
  );
}
