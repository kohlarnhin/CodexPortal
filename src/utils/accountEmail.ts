export function maskEmail(email: string) {
  const separatorIndex = email.lastIndexOf('@');
  if (separatorIndex <= 0) return email;

  const localPart = email.slice(0, separatorIndex);
  const domain = email.slice(separatorIndex + 1);

  if (localPart.length === 1) return `*@${domain}`;
  if (localPart.length === 2) return `${localPart[0]}*@${domain}`;

  return `${localPart[0]}***${localPart[localPart.length - 1]}@${domain}`;
}

export function getDisplayedEmail(email: string, isMaskingEnabled: boolean) {
  return isMaskingEnabled ? maskEmail(email) : email;
}
