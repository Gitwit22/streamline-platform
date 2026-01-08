import { v4 as uuidv4 } from 'uuid';

export interface MockRecording {
  id: string;
  title: string;
  roomName: string;
  status: 'recording' | 'processing' | 'ready' | 'failed';
  progress: number;
  duration: number;
  viewerCount: number;
  peakViewers: number;
  videoUrl: string;
  thumbnailUrl: string;
  createdAt: string;
  error?: string;
}

function simulateProcessing(recordingId: string): Promise<MockRecording> {
  return new Promise((resolve) => {
    const mockRecording: MockRecording = {
      id: recordingId,
      title: `Stream - ${new Date().toLocaleString()}`,
      roomName: `room_${recordingId}`,
      status: 'processing',
      progress: 0,
      duration: Math.floor(Math.random() * 5400) + 600,
      viewerCount: Math.floor(Math.random() * 200) + 10,
      peakViewers: Math.floor(Math.random() * 200) + 10,
      videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-library/sample/BigBuckBunny.mp4',
      thumbnailUrl: 'https://placehold.co/320x180?text=Recording',
      createdAt: new Date().toISOString(),
    };

    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 30;
      if (progress >= 100) {
        clearInterval(interval);
        mockRecording.status = 'ready';
        mockRecording.progress = 100;

        const recordings = JSON.parse(
          localStorage.getItem('sl_recordings') || '[]'
        );
        const index = recordings.findIndex((r: MockRecording) => r.id === recordingId);
        if (index !== -1) {
          recordings[index] = mockRecording;
        } else {
          recordings.push(mockRecording);
        }
        localStorage.setItem('sl_recordings', JSON.stringify(recordings));

        window.dispatchEvent(
          new CustomEvent('recordingProgress', { detail: mockRecording })
        );

        resolve(mockRecording);
      } else {
        mockRecording.progress = Math.min(progress, 99);
        window.dispatchEvent(
          new CustomEvent('recordingProgress', { detail: mockRecording })
        );
      }
    }, 300);
  });
}

export const mockRecordingApi = {
  startRecording: async (roomName: string, title: string) => {
    await new Promise((resolve) => setTimeout(resolve, 500));

    const recordingId = `rec_${uuidv4()}`;
    const recording: MockRecording = {
      id: recordingId,
      title,
      roomName,
      status: 'recording',
      progress: 0,
      duration: 0,
      viewerCount: 0,
      peakViewers: 0,
      videoUrl: '',
      thumbnailUrl: 'https://placehold.co/320x180?text=Recording',
      createdAt: new Date().toISOString(),
    };

    const recordings = JSON.parse(
      localStorage.getItem('sl_recordings') || '[]'
    );
    recordings.push(recording);
    localStorage.setItem('sl_recordings', JSON.stringify(recordings));

    return recording;
  },

  stopRecording: async (recordingId: string, stats: any) => {
    await new Promise((resolve) => setTimeout(resolve, 500));

    const recordings = JSON.parse(
      localStorage.getItem('sl_recordings') || '[]'
    );
    const recording = recordings.find((r: MockRecording) => r.id === recordingId);

    if (recording) {
      recording.viewerCount = stats.viewerCount;
      recording.peakViewers = stats.peakViewers;
      recording.status = 'processing';
      localStorage.setItem('sl_recordings', JSON.stringify(recordings));
    }

    simulateProcessing(recordingId);

    return { recordingId, status: 'processing' };
  },

  getRecording: async (recordingId: string): Promise<MockRecording | null> => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const recordings = JSON.parse(
      localStorage.getItem('sl_recordings') || '[]'
    );
    return recordings.find((r: MockRecording) => r.id === recordingId) || null;
  },

  getAllRecordings: async (): Promise<MockRecording[]> => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return JSON.parse(localStorage.getItem('sl_recordings') || '[]');
  },

  deleteRecording: async (recordingId: string) => {
    const recordings = JSON.parse(
      localStorage.getItem('sl_recordings') || '[]'
    );
    const filtered = recordings.filter((r: MockRecording) => r.id !== recordingId);
    localStorage.setItem('sl_recordings', JSON.stringify(filtered));
    return { deleted: true };
  },

  deleteRecordingSync: (recordingId: string) => {
    const recordings = JSON.parse(
      localStorage.getItem('sl_recordings') || '[]'
    );
    const filtered = recordings.filter((r: MockRecording) => r.id !== recordingId);
    localStorage.setItem('sl_recordings', JSON.stringify(filtered));
    return { deleted: true };
  },

  listRecordings: (): MockRecording[] => {
    // Synchronous version for dashboard
    return JSON.parse(localStorage.getItem('sl_recordings') || '[]');
  },
};
