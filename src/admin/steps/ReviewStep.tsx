import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { WizardState, WizardAction } from '../wizardReducer';
import { buildConfig } from '../utils/buildConfig';
import { songConfigSchema } from '../../config/schema';
import { uploadFileWithProgress, uploadFormWithProgress } from '../utils/uploadWithProgress';
import { retryStem, uploadStems, waitForStems, type StemJobState } from '../utils/stemJobs';
import { StemProgress } from '../components/StemProgress';
import { prepareSheetMusicUpload } from '../utils/sheetMusic';
import { dataUrl } from '../../utils/url';
import { useBandStore } from '../../store/bandStore';
import { slugify } from '../../utils/deriveId';

interface Props {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  /** The song is saved: nothing left to lose by leaving. */
  onSaved: () => void;
  /** Start the wizard over for the next song. */
  onAddAnother: () => void;
}

export function ReviewStep({ state, dispatch, onSaved, onAddAnother }: Props) {
  const [result, setResult] = useState<'success' | null>(null);
  /** Per-stem upload and transcode progress, once saving starts. */
  const [stemStates, setStemStates] = useState<StemJobState[] | null>(null);
  /** Where a retried save picks up. */
  const [pending, setPending] = useState<{ bandId: string; publicBase: string } | null>(null);
  const { bandSlug = '' } = useParams();
  const navigate = useNavigate();
  const bandName = useBandStore((s) => s.currentBand?.name ?? '');
  const config = buildConfig(state, bandName);
  const validation = songConfigSchema.safeParse(config);

  /** After the stems: sheet music, the config, the discography entry. */
  const saveRest = async (bandId: string, publicBase: string) => {
    let transcodedConfig: typeof config = {
      ...config,
      stems: config.stems.map((stem) => ({ ...stem, file: `${stem.id}.opus` })),
    };

    // 2b. Upload sheet music (optional). Two paths depending on format:
    // - `.mxl` / `.musicxml` / `.xml` → presigned PUT straight to R2;
    //   plain XML gets zipped to MXL client-side (20–50× smaller).
    // - `.mscz` → POST to the server-side conversion endpoint, which
    //   shells out to the `mscore` CLI and writes `score.mxl` on R2.
    // In both cases `sheetMusicUrl` lands on the canonical `score.mxl`.
    if (state.sheetMusicFile) {
      const prepared = await prepareSheetMusicUpload(state.sheetMusicFile);
      if (!prepared) throw new Error('Unsupported sheet music file type');
      if (prepared.mode === 'server-convert') {
        const { file, filename } = prepared;
        const sheetForm = new FormData();
        sheetForm.append('sheetMusic', file, file.name);
        dispatch({ type: 'SET_UPLOAD_PROGRESS', progress: {
          fileIndex: 0, fileCount: 1, bytesSent: 0, bytesTotal: file.size,
        }});
        const convertResult = await uploadFormWithProgress(
          `/api/r2/mscz-convert-upload/${bandId}/${state.id}?filename=${encodeURIComponent(filename)}`,
          sheetForm,
          (bytesSent, bytesTotal) => {
            dispatch({ type: 'SET_UPLOAD_PROGRESS', progress: {
              fileIndex: 0, fileCount: 1, bytesSent, bytesTotal,
            }});
          },
        );
        if (!convertResult.ok) throw new Error(convertResult.error ?? 'MSCZ conversion failed');
        dispatch({ type: 'SET_UPLOAD_PROGRESS', progress: null });
        transcodedConfig = { ...transcodedConfig, sheetMusicUrl: filename };
      } else {
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
    const finalSlug = slugify(state.slug);
    const discographyRes = await fetch(`/api/bands/${bandId}/songs/discography`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: state.id,
        ...(finalSlug ? { slug: finalSlug } : {}),
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
    onSaved();
  };

  /**
   * Wait for every stem's transcode, then save the rest. A failed stem stops
   * here with Retry beside it; nothing else is saved until every stem is done.
   */
  const finish = async (bandId: string, publicBase: string, stems: StemJobState[]) => {
    const final = await waitForStems(bandId, state.id, stems, setStemStates);
    if (final.some((s) => s.phase === 'failed')) {
      throw new Error('Some stems couldn’t be prepared. Retry them below, or go back and replace the file.');
    }
    await saveRest(bandId, publicBase);
  };

  const run = async (work: () => Promise<void>) => {
    dispatch({ type: 'SET_SAVING', saving: true });
    dispatch({ type: 'SET_ERROR', error: null });
    try {
      await work();
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: (err as Error).message });
    } finally {
      dispatch({ type: 'SET_SAVING', saving: false });
    }
  };

  const handleSave = () => run(async () => {
      // Resolve band first so we can use bandId in all subsequent calls
      const bandsRes = await fetch(dataUrl('registry.json'));
      const bandsData = await bandsRes.json();
      const band = (bandsData.bands as { id: string; route: string }[]).find((b) => b.route === bandSlug);
      const bandId = band?.id ?? '';

      // Pre-flight collision check: refuse if a song already exists at this
      // derived id. Without this, the stem uploads + config POST would
      // silently overwrite that song's R2 files. (The server returns 409 as
      // a backstop, but by then the stems are already on R2.)
      let collision = false;
      try {
        const discRes = await fetch(dataUrl(`${bandId}/songs/discography.json`));
        if (discRes.ok) {
          const disc = await discRes.json();
          collision = Array.isArray(disc?.songs) && disc.songs.some((s: { id: string }) => s.id === state.id);
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

      // 1. Stems go straight to storage, then the server's job queue
      // transcodes each to `${stemId}.opus` (Phase 9). Alignment offsets
      // aren't baked in — they live in config.json's offsetSec fields.
      const { states, publicBase } = await uploadStems(
        bandId,
        state.id,
        state.stems.map((entry, i) => ({ stemId: config.stems[i].id, file: entry.file })),
        state.normalize,
        setStemStates,
      );
      setPending({ bandId, publicBase });
      await finish(bandId, publicBase, states);
  });

  const handleRetry = (jobId: string) => run(async () => {
    if (!pending || !stemStates) return;
    await retryStem(pending.bandId, state.id, jobId);
    const states = stemStates.map((s) => (s.jobId === jobId ? { ...s, phase: 'waiting' as const, progress: 0, error: null } : s));
    setStemStates(states);
    await finish(pending.bandId, pending.publicBase, states);
  });

  if (result === 'success') {
    return (
      <div className="space-y-6 text-center py-12">
        <p className="text-2xl text-green-400">Song added!</p>
        <p className="text-gray-400">
          <span className="font-mono text-gray-300">{state.title}</span> by{' '}
          <span className="text-gray-300">{state.artist}</span> has been saved.
        </p>
        <div className="flex justify-center gap-3">
          <button
            onClick={() => navigate(`/${bandSlug}#${slugify(state.slug) || state.id}`)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium"
          >
            Open Song
          </button>
          <button onClick={onAddAnother} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm">
            Add another song
          </button>
        </div>
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

      {/* Stems: upload, then the server's transcode, one row each */}
      {stemStates && <StemProgress stems={stemStates} onRetry={handleRetry} retrying={state.saving} />}

      {/* Sheet music upload */}
      {state.uploadProgress && (() => {
        const pct = state.uploadProgress.bytesTotal
          ? Math.round((state.uploadProgress.bytesSent / state.uploadProgress.bytesTotal) * 100)
          : 0;
        const uploading = pct < 100;
        return (
          <div className="space-y-1">
            <p className="text-sm text-gray-400">
              {uploading ? `Uploading sheet music (${pct}%)...` : 'Converting sheet music...'}
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
            ? stemStates?.some((s) => s.phase !== 'done') ? 'Preparing stems...' : 'Saving...'
            : 'Save Song'}
        </button>
      </div>
    </div>
  );
}
