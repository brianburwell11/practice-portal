export interface UploadProgress {
  fileIndex: number;
  fileCount: number;
  bytesSent: number;
  bytesTotal: number;
}

interface TranscodeUploadResult {
  ok: boolean;
  error?: string;
  fileMap: Record<string, string>;
  publicBase: string;
}

export function uploadFormWithProgress(
  url: string,
  formData: FormData,
  onProgress: (bytesSent: number, bytesTotal: number) => void,
): Promise<TranscodeUploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ ok: true, fileMap: data.fileMap, publicBase: data.publicBase });
        } else {
          resolve({ ok: false, error: data.error, fileMap: {}, publicBase: '' });
        }
      } catch {
        resolve({ ok: false, error: `Upload failed (status ${xhr.status})`, fileMap: {}, publicBase: '' });
      }
    };
    xhr.onerror = () => reject(new Error('Upload network error'));
    xhr.send(formData);
  });
}

export function uploadFileWithProgress(
  url: string,
  file: Blob,
  onProgress: (bytesSent: number, bytesTotal: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (status ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload network error'));
    xhr.send(file);
  });
}
