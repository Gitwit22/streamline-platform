/**
 * Download Service - Handles video downloads with progress tracking
 */

export interface DownloadProgress {
  percent: number;
  loaded: number;
  total: number;
  speed: number; // bytes per second
  timeRemaining: number; // seconds
}

export const downloadService = {
  /**
   * Download a video file from URL with progress tracking
   */
  downloadVideo: async (
    videoUrl: string,
    fileName: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const startTime = Date.now();

      // Track download progress
      xhr.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const percentComplete = (event.loaded / event.total) * 100;
          const now = Date.now();
          
          // Calculate speed (bytes per second)
          const speed = event.loaded / ((now - startTime) / 1000);
          
          // Calculate time remaining
          const remaining = (event.total - event.loaded) / speed;

          onProgress?.({
            percent: percentComplete,
            loaded: event.loaded,
            total: event.total,
            speed,
            timeRemaining: remaining,
          });
        }
      });

      // Handle completion
      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          // Create blob from response
          const blob = new Blob([xhr.response], { type: 'video/mp4' });

          // Create download link
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);

          resolve();
        } else {
          reject(new Error(`Download failed with status ${xhr.status}`));
        }
      });

      // Handle errors
      xhr.addEventListener('error', () => {
        reject(new Error('Download error'));
      });

      xhr.addEventListener('abort', () => {
        reject(new Error('Download aborted'));
      });

      // Start download
      xhr.open('GET', videoUrl, true);
      xhr.responseType = 'arraybuffer';
      xhr.send();
    });
  },

  /**
   * Download multiple files as a batch
   */
  downloadBatch: async (
    files: Array<{ url: string; name: string }>,
    onProgress?: (current: number, total: number, currentFileName: string) => void
  ): Promise<void> => {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      onProgress?.(i + 1, files.length, file.name);
      await downloadService.downloadVideo(file.url, file.name);
    }
  },

  /**
   * Create a simple download by creating a blob URL
   */
  downloadBlob: (blob: Blob, fileName: string): void => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  /**
   * Create mock video file for testing
   */
  createMockVideoBlob: (): Blob => {
    // Create a simple MP4-like binary data
    // This is just a placeholder - actual videos should come from server
    const data = new Uint8Array([
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70,
      0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00,
      0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
      0x6d, 0x70, 0x34, 0x31, 0x69, 0x73, 0x6f, 0x70,
    ]);
    return new Blob([data], { type: 'video/mp4' });
  },

  /**
   * Format bytes to human-readable format
   */
  formatBytes: (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  },

  /**
   * Format seconds to human-readable time
   */
  formatTime: (seconds: number): string => {
    if (!isFinite(seconds) || seconds === 0) return '—';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.round(seconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  },
};

export default downloadService;
