import styled from "@emotion/styled";
import { faInfoCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useState, type ReactNode } from "react";
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from "@floating-ui/react";

const StyledInfoButton = styled.button`
  display: inline-flex;
  align-items: center;
  padding: 2px;
  margin: 0;
  background: transparent;
  color: var(--muted);
  min-height: 24px;
  min-width: 24px;
  border: 0;
  cursor: help;
`;

const StyledContent = styled.div`
  z-index: 1080;
  background-color: var(--surface-raised);
  color: var(--text);
  box-shadow: 0 4px 16px #0006;
  width: 400px;
  max-width: calc(100vw - 32px);
  border-radius: 10px;
  border: 1px solid var(--border);
  font-size: 13px;
  line-height: 1.6;
  padding: 16px;
`;

export function InfoTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const {
    refs: { setReference, setFloating },
    floatingStyles,
    context,
  } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: "top",
    middleware: [offset(8), flip(), shift({ padding: 16 })],
    whileElementsMounted: autoUpdate,
  });
  const hover = useHover(context, { move: false, handleClose: safePolygon() });
  const focus = useFocus(context, { visibleOnly: false });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
    role,
  ]);

  return (
    <>
      <StyledInfoButton
        type="button"
        ref={setReference}
        aria-label={label}
        {...getReferenceProps()}
      >
        <FontAwesomeIcon icon={faInfoCircle} aria-hidden="true" />
      </StyledInfoButton>
      {isOpen && (
        <FloatingPortal>
          <StyledContent
            ref={setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
          >
            {children}
          </StyledContent>
        </FloatingPortal>
      )}
    </>
  );
}
