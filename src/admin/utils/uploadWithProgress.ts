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

/** An upload that sends nothing for this long is given up on. */
const STALL_MS = 60_000;

/**
 * PUT a file to a presigned URL. `contentType` must be the type the server
 * signed into the URL, or storage refuses the upload.
 *
 * A dropped connection doesn't always end in an error: the request can just
 * sit there forever. So if no bytes move for `STALL_MS`, it's aborted and
 * rejects, and the caller can try again.
 */
export function uploadFileWithProgress(
  url: string,
  file: Blob,
  contentType: string,
  onProgress: (bytesSent: number, bytesTotal: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let stalled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { stalled = true; xhr.abort(); }, STALL_MS);
    };
    const fail = (message: string) => { clearTimeout(timer); reject(new Error(message)); };
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => {
      arm();
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      clearTimeout(timer);
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (status ${xhr.status})`));
    };
    xhr.onerror = () => fail('Upload network error');
    xhr.onabort = () => fail(stalled ? 'Upload stalled, no data sent for a minute' : 'Upload cancelled');
    arm();
    xhr.send(file);
  });
}
