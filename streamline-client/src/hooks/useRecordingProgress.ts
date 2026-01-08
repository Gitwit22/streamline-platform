import { useState, useEffect } from 'react';
import { MockRecording } from '../services/mockRecording';
import { mockRecordingApi } from '../services/mockRecording';

export function useRecordingProgress(recordingId: string | undefined) {
  const [recording, setRecording] = useState<MockRecording | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!recordingId) {
      setLoading(false);
      return;
    }

    mockRecordingApi.getRecording(recordingId).then((data) => {
      setRecording(data);
      setLoading(false);
    });

    const handleProgress = (event: Event) => {
      const customEvent = event as CustomEvent<MockRecording>;
      if (customEvent.detail.id === recordingId) {
        setRecording(customEvent.detail);
      }
    };

    const pollInterval = setInterval(async () => {
      const updated = await mockRecordingApi.getRecording(recordingId);
      if (updated) {
        setRecording(updated);
      }
    }, 1000);

    window.addEventListener('recordingProgress', handleProgress);

    return () => {
      clearInterval(pollInterval);
      window.removeEventListener('recordingProgress', handleProgress);
    };
  }, [recordingId]);

  return { recording, loading };
}
