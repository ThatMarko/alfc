import { type ReactNode, useState } from "react";
import { Tooltip, type TooltipProps } from "reactstrap";
import styled from "@emotion/styled";

const StyledContent = styled.div<{
  unlimitedWidth?: boolean;
}>`
  background-color: white;
  color: #202027;
  box-shadow: 0 4px 16px #0006;
  max-width: calc(100vw - 32px);
  border-radius: 4px;
  padding: 16px;
  margin: 0;
  ${({ unlimitedWidth }) => (unlimitedWidth ? "" : "width: 400px;")}
`;

export const SimpleTooltip = ({
  children,
  unlimitedWidth = false,
  ...props
}: TooltipProps & {
  children: ReactNode;
  unlimitedWidth?: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    // Warning in console can be ignored:
    // https://github.com/reactstrap/reactstrap/issues/2819
    <Tooltip
      isOpen={isOpen}
      autohide={false}
      style={{ zIndex: 1080 }}
      toggle={() => setIsOpen((prevIsOpen) => !prevIsOpen)}
      {...props}
    >
      <StyledContent unlimitedWidth={unlimitedWidth}>{children}</StyledContent>
    </Tooltip>
  );
};
