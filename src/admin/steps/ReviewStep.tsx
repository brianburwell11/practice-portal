import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { WizardState, WizardAction } from '../wizardReducer';
import { buildConfig } from '../utils/buildConfig';
import { songConfigSchema } from '../../config/schema';
import { uploadFileWithProgress, uploadFormWithProgress } from '../utils/uploadWithProgress';
import { prepareSheetMusicUpload } from '../utils/sheetMusic';
import { r2Url } from '../../utils/url';
import { useBandStore } from '../../store/bandStore';

interface Props {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i) : '';
}

export function ReviewStep({ state, dispatch }: Props) {
  const [result, setResult] = useState<'success' | null>(null);
  const { bandSlug = '' } = useParams();
  const bandName = useBandStore((s) => s.currentBand?.name ?? '');
  const config = buildConfig(state, bandName);
  const validation = songConfigSchema.safeParse(config);

  const handleSave = async () => {
    dispatch({ type: 'SET_SAVING', saving: true });
    dispatch({ type: 'SET_ERROR', error: null });

    try {
      // Resolve band first so we can use bandId in all subsequent calls
      const bandsRes = await fetch(r2Url('registry.json'));
      const bandsData = await bandsRes.json();
      const band = bandsData.bands.find((b: any) => b.route === bandSlug);
      const bandId = band?.id ?? '';

      // Pre-flight collision check: refuse if a song already exists at this
      // derived id. Without this, transcode-upload + config POST would
      // silently overwrite that song's R2 files. (The server returns 409 as
      // a backstop, but by then the stems are already on R2.)
      let collision = false;
      try {
        const discRes = await fetch(r2Url(`${bandId}/songs/discography.json`));
        if (discRes.ok) {
          const disc = await discRes.json();
          collision = Array.isArray(disc?.songs) && disc.songs.some((s: any) => s.id === state.id);
        }
        // Non-OK (e.g. 404 on a fresh bucket) → no collision possible.
      } catch {
        // Network/parse failure — fall through and let the server 409 guard it.
      }
      if (collision) {
        throw new Error(
          `A song with id "${state.id}" already exists. Delete it first or change the title/artist.`,
        );
      }

      // 1. Upload stems to server for transcoding + R2 upload.
      // Alignment offsets are NOT baked in — they live in config.json's
      // offsetSec fields and are applied at playback time by StemPlayer.
      // Upload each stem as `${stemId}${origExt}` so the server transcodes to
      // the canonical `${stemId}.opus` on R2 — config.json then just references
      // `${stemId}.opus` with no round-trip through the original filename.
      const formData = new FormData();
      state.stems.forEach((entry, i) => {
        formData.append('stems', entry.file, `${config.stems[i].id}${extOf(entry.file.name)}`);
      });

      dispatch({ type: 'SET_UPLOAD_PROGRESS', progress: {
        fileIndex: 0, fileCount: state.stems.length, bytesSent: 0, bytesTotal: 1,
      }});

      const uploadResult = await uploadFormWithProgress(
        `/api/r2/transcode-upload/${bandId}/${state.id}`,
        formData,
        (bytesSent, bytesTotal) => {
          dispatch({ type: 'SET_UPLOAD_PROGRESS', progress: {
            fileIndex: 0, fileCount: state.stems.length, bytesSent, bytesTotal,
          }});
        },
      );

      if (!uploadResult.ok) throw new Error(uploadResult.error ?? 'Upload failed');
      const { publicBase } = uploadResult;
      dispatch({ type: 'SET_UPLOAD_PROGRESS', progress: null });

      // 2. Update config stem filenames to match the canonical opus names
      let transcodedConfig: typeof config = {
        ...config,
        stems: config.stems.map((stem) => ({
          ...stem,
          file: `${stem.id}.opus`,
        })),
      };

      // 2b. Upload sheet music (optional). Presigned PUT straight to R2;
      // `sheetMusicUrl` gets the canonical name `score.mxl`. Plain-XML
      // inputs are zipped to MXL client-side to slash storage/transfer
      // (MusicXML → MXL is typically 20–50× smaller).
      if (state.sheetMusicFile) {
        const prepared = await prepareSheetMusicUpload(state.sheetMusicFile);
        if (!prepared) throw new Error('Unsupported sheet music file type');
        const { blob, filename } = prepared;
        const presignRes = await fetch('/api/r2/presign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bandId, songId: state.id, files: [filename] }),
        });
        if (!presignRes.ok) {
          const err = await presignRes.json().catch(() => ({}));
          throw new Error(err.error ?? 'Sheet music presign failed');
        }
        const { urls } = (await presignRes.json()) as { urls: Record<string, string> };
        const putUrl = urls[filename];
        if (!putUrl) throw new Error('Sheet music presign returned no URL');
        dispatch({ type: 'SET_UPLOAD_PROGRESS', progress: {
          fileIndex: 0, fileCount: 1, bytesSent: 0, bytesTotal: blob.size,
        }});
        await uploadFileWithProgress(putUrl, blob, (bytesSent, bytesTotal) => {
          dispatch({ type: 'SET_UPLOAD_PROGRESS', progress: {
            fileIndex: 0, fileCount: 1, bytesSent, bytesTotal,
          }});
        });
        dispatch({ type: 'SET_UPLOAD_PROGRESS', progress: null });
        transcodedConfig = { ...transcodedConfig, sheetMusicUrl: filename };
      }

      const configRes = await fetch(`/api/bands/${bandId}/songs/${state.id}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transcodedConfig),
      });
      if (!configRes.ok) {
        const err = await configRes.json();
        throw new Error(err.error || 'Config save failed');
      }

      // 4. Update discography with R2 audio path
      const discographyRes = await fetch(`/api/bands/${bandId}/songs/discography`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: state.id,
          title: state.title,
          artist: state.artist,
          audioBasePath: publicBase,
        }),
      });
      if (!discographyRes.ok) {
        const err = await discographyRes.json();
        throw new Error(err.error || 'Discography update failed');
      }
      setResult('success');
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', error: err.message });
    } finally {
      dispatch({ type: 'SET_SAVING', saving: false });
    }
  };

  if (result === 'success') {
    return (
      <div className="space-y-6 text-center py-12">
        <p className="text-2xl text-green-400">Song added!</p>
        <p className="text-gray-400">
          <span className="font-mono text-gray-300">{state.title}</span> by{' '}
          <span className="text-gray-300">{state.artist}</span> has been saved to R2.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Review & Save</h2>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-gray-400">Title:</span>{' '}
          <span className="text-gray-100">{state.title}</span>
        </div>
        <div>
          <span className="text-gray-400">Artist:</span>{' '}
          <span className="text-gray-100">{state.artist}</span>
        </div>
        <div>
          <span className="text-gray-400">Key:</span>{' '}
          <span className="text-gray-100">{state.key || '(none)'}</span>
        </div>
        <div>
          <span className="text-gray-400">ID:</span>{' '}
          <span className="font-mono text-gray-100">{state.id}</span>
        </div>
        <div>
          <span className="text-gray-400">Stems:</span>{' '}
          <span className="text-gray-100">{state.stems.length}</span>
        </div>
        <div>
          <span className="text-gray-400">Duration:</span>{' '}
          <span className="text-gray-100">{config.durationSeconds.toFixed(2)}s</span>
        </div>
        <div>
          <span className="text-gray-400">Timing:</span>{' '}
          <span className="text-gray-100">
            {state.timingMode === 'xsc'
              ? `XSC (${state.tapMap.length} entries)`
              : state.timingMode === 'manual'
                ? `${state.manualBpm} BPM, ${state.timeSignatureNumerator}/${state.timeSignatureDenominator}`
                : 'Default (120 BPM, 4/4)'}
          </span>
        </div>
        <div>
          <span className="text-gray-400">Groups:</span>{' '}
          <span className="text-gray-100">
            {state.groups.length > 0 ? state.groups.map((g) => g.label).join(', ') : 'None'}
          </span>
        </div>
      </div>

      {/* Validation */}
      {!validation.success && (
        <div className="bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-300">
          <p className="font-medium mb-1">Validation errors:</p>
          {validation.error.issues.map((issue, i) => (
            <p key={i}>
              {issue.path.join('.')}: {issue.message}
            </p>
          ))}
        </div>
      )}

      {/* Config JSON */}
      <details className="group">
        <summary className="text-sm text-gray-400 cursor-pointer hover:text-gray-300">
          View config.json
        </summary>
        <pre className="mt-2 bg-gray-800 rounded p-3 text-xs text-gray-300 overflow-x-auto max-h-96">
          {JSON.stringify(config, null, 2)}
        </pre>
      </details>

      {/* Error */}
      {state.error && (
        <div className="bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-300">
          {state.error}
        </div>
      )}

      {/* Upload progress */}
      {state.uploadProgress && (() => {
        const pct = state.uploadProgress.bytesTotal
          ? Math.round((state.uploadProgress.bytesSent / state.uploadProgress.bytesTotal) * 100)
          : 0;
        const uploading = pct < 100;
        return (
          <div className="space-y-1">
            <p className="text-sm text-gray-400">
              {uploading
                ? `Uploading ${state.stems.length} stems (${pct}%)...`
                : 'Transcoding & uploading to storage...'}
            </p>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${uploading ? 'bg-blue-500' : 'bg-blue-500 animate-pulse'}`}
                style={{ width: uploading ? `${pct}%` : '100%' }}
              />
            </div>
          </div>
        );
      })()}

      <div className="flex justify-between">
        <button
          onClick={() => dispatch({ type: 'PREV_STEP' })}
          disabled={state.saving}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-sm"
        >
          Back
        </button>
        <button
          disabled={!validation.success || state.saving}
          onClick={handleSave}
          className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium"
        >
          {state.saving
            ? state.uploadProgress ? 'Uploading...' : 'Saving...'
            : 'Save Song'}
        </button>
      </div>
    </div>
  );
}
