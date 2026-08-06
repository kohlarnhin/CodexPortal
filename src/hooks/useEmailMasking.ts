import { useState } from 'react';

const EMAIL_MASKING_STORAGE_KEY = 'codex-portal.email-masking-enabled';

function readInitialEmailMaskingState() {
  try {
    return window.localStorage.getItem(EMAIL_MASKING_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function useEmailMasking() {
  const [isEmailMaskingEnabled, setIsEmailMaskingEnabled] = useState(readInitialEmailMaskingState);

  const toggleEmailMasking = () => {
    setIsEmailMaskingEnabled(currentValue => {
      const nextValue = !currentValue;

      try {
        window.localStorage.setItem(EMAIL_MASKING_STORAGE_KEY, String(nextValue));
      } catch {
        // Keep the in-memory preference when persistent storage is unavailable.
      }

      return nextValue;
    });
  };

  return {
    isEmailMaskingEnabled,
    toggleEmailMasking,
  };
}
