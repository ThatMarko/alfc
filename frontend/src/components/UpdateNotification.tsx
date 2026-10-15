import styled from "@emotion/styled";
import { theme } from "../utils/consts";
import { useVersionCheck } from "../utils/useVersionCheck";

const StyledLink = styled.a`
  display: inline-block;
  margin-top: 16px;
  padding: 8px 16px;
  background-color: ${theme.primary};
  color: #202027;
  text-decoration: none;
  border-radius: 4px;
  font-size: 14px;
  max-width: calc(100vw - 32px);

  &:hover {
    opacity: 0.9;
  }
`;

export function UpdateNotification() {
  const newVersionAvailable = useVersionCheck();

  return newVersionAvailable ? (
    <StyledLink
      href="https://github.com/ThatMarko/alfc/releases/latest"
      target="_blank"
      rel="noopener noreferrer"
    >
      New version available!
    </StyledLink>
  ) : null;
}
