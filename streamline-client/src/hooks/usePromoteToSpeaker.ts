import { useState, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001';

interface PromoteResult {
  ok: boolean;
  identity: string;
  role: string;
  permissions: {
    canPublish: boolean;
    canPublishData: boolean;
    canPublishSources: string[];
  };
}

interface PromoteError {
  error: string;
  message?: string;
}

/**
 * Hook for promoting viewer guests to speaker role (enables mic+cam).
 * 
 * @param roomId - The room ID
 * @param roomAccessToken - Host's room access token for authorization
 * 
 * @returns {Object} Hook return object
 * @returns {Function} promoteToSpeaker - Async function to promote a guest
 * @returns {boolean} isPromoting - Whether a promotion is currently in progress
 * @returns {string | null} error - Error message if promotion fails
 * 
 * @example
 * const { promoteToSpeaker, isPromoting, error } = usePromoteToSpeaker(roomId, roomAccessToken);
 * 
 * const handlePromote = async (guestIdentity: string) => {
 *   const result = await promoteToSpeaker(guestIdentity);
 *   if (result.ok) {
 *     console.log('Guest promoted to speaker!');
 *   } else {
 *     console.error('Promotion failed:', error);
 *   }
 * };
 */
export function usePromoteToSpeaker(roomId: string, roomAccessToken: string | null) {
  const [isPromoting, setIsPromoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const promoteToSpeaker = useCallback(
    async (guestIdentity: string): Promise<PromoteResult | PromoteError> => {
      if (!roomAccessToken) {
        const err = 'No room access token available';
        setError(err);
        return { error: err };
      }

      if (!guestIdentity || !guestIdentity.trim()) {
        const err = 'Guest identity is required';
        setError(err);
        return { error: err };
      }

      setIsPromoting(true);
      setError(null);

      try {
        const response = await fetch(
          `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(guestIdentity)}/promote`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-room-access-token': roomAccessToken,
            },
            credentials: 'include',
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          const errorMsg = errorData.error || `HTTP ${response.status}`;
          setError(errorMsg);
          return { error: errorMsg, message: errorData.message };
        }

        const result: PromoteResult = await response.json();
        console.log('[usePromoteToSpeaker] Guest promoted successfully:', {
          identity: guestIdentity,
          role: result.role,
          permissions: result.permissions,
        });

        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Network error';
        setError(errorMsg);
        console.error('[usePromoteToSpeaker] Failed to promote guest:', err);
        return { error: errorMsg };
      } finally {
        setIsPromoting(false);
      }
    },
    [roomId, roomAccessToken]
  );

  return {
    promoteToSpeaker,
    isPromoting,
    error,
  };
}
