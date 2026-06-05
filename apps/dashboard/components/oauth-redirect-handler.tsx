'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

type OAuthRedirectHandlerProps = {
  onSuccess: (code: string) => void;
  onError: (message: string) => void;
};

/**
 * Reads OAuth callback params from the URL and notifies the parent wizard.
 *
 * @param onSuccess - Called with the authorization code on success
 * @param onError - Called with an error message on failure
 */
export function OAuthRedirectHandler({
  onSuccess,
  onError,
}: OAuthRedirectHandlerProps): null {
  const params = useSearchParams();

  useEffect(() => {
    const code = params.get('code');
    const error = params.get('error');
    const errorDescription = params.get('error_description');

    if (code) {
      onSuccess(code);
    } else if (error) {
      onError(errorDescription ?? error);
    }
  }, [params, onSuccess, onError]);

  return null;
}
