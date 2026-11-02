import { useEffect, useMemo, useState } from 'react';
import type { WizardAction, StemEntry } from '../wizardReducer';
import type { StemGroupConfig } from '../../audio/types';
import type { AbletonSet, AlsAudioClip, AlsTrack } from '../ableton/alsParser';
import type { DroppedFile } from '../ableton/projectFiles';
import { collectDroppedFiles, findSets, makeResolver, matchExports } from '../ableton/projectFiles';
import type { ImportRow } from '../ableton/importRows';
import { buildRows, cleanTrackLabel, setNameFromFile } from '../ableton/importRows';
import { renderTrack, renderTrackPcm, RENDER_SAMPLE_RATE } from '../ableton/renderTrack';
import { decodeSource } from '../ableton/decodeSource';
import { isAbletonProtected } from '../ableton/aiff';
import { pcmFromAudioBuffer, pcmToAudioBuffer } from '../ableton/pcm';
import { callAudioWorker, newMixId } from '../ableton/workerClient';
import { TempoMap } from '../ableton/timeline';
import { buildTiming } from '../ableton/buildTiming';
import { isAudioFile } from '../utils/stemDetection';

interface Props {
  files: DroppedFile[];
  dispatch: React.Dispatch<WizardAction>;
  onClose: () => void;
}

const palette = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6',
];

function kebab(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function uniqueId(base: string, taken: Set<string>): string {
  let id = base || 'stem';
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

const clampVolume = (v: number) => Math.min(1.5, Math.max(0, Math.round(v * 1000) / 1000));

/**
 * Folder a missing sample was in, as Live recorded it. Short climbs out of
 * the project are shared folders next to it, which a bigger drop can fill
 * in; anything else was elsewhere on the computer that saved the set.
 */
function missingFolder(clip: AlsAudioClip): { dir: string; nearby: boolean } {
  const rel = clip.file.relativePath;
  const ups = rel.split('/').filter((s) => s === '..').length;
  const nearby = !!rel && ups <= 2;
  const path = nearby ? rel : clip.file.path || rel;
  return { dir: path.slice(0, path.lastIndexOf('/')) || path, nearby };
}

function mergeFiles(a: DroppedFile[], b: DroppedFile[]): DroppedFile[] {
  const seen = new Set(a.map((f) => f.path));
  return [...a, ...b.filter((f) => !seen.has(f.path))];
}

export function AbletonImportPanel({ files: initialFiles, dispatch, onClose }: Props) {
  const [files, setFiles] = useState(initialFiles);
  const sets = useMemo(() => findSets(files), [files]);
  const [alsPath, setAlsPath] = useState<string | null>(sets.length === 1 ? sets[0].path : null);
  const als = sets.find((f) => f.path === alsPath) ?? null;
  const setName = als ? setNameFromFile(als.file.name) : '';
  const [set, setSet] = useState<AbletonSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Ticks the user changed; everything else follows the defaults. */
  const [tickOverrides, setTickOverrides] = useState<Map<string, boolean>>(new Map());
  /** Export files the user dropped (or removed, as null) per track. */
  const [exportOverrides, setExportOverrides] = useState<Map<string, File | null>>(new Map());
  const [progress, setProgress] = useState<string | null>(null);
  const [addingFiles, setAddingFiles] = useState(false);
  /** Ableton group track ids to import as one mixed stem. */
  const [mixedGroups, setMixedGroups] = useState<Set<string>>(new Set());

  const resolve = useMemo(() => (als ? makeResolver(files, als) : () => null), [files, als]);
  /** Resolved files that are encrypted Ableton Pack audio; found by reading headers. */
  const [protectedFiles, setProtectedFiles] = useState<Set<File>>(new Set());
  useEffect(() => {
    if (!set) return;
    let cancelled = false;
    const used = new Set<File>();
    for (const t of set.tracks) for (const c of t.clips) {
      const f = resolve(c);
      if (f) used.add(f);
    }
    Promise.all([...used].map(async (f) => ((await isAbletonProtected(f)) ? f : null))).then((found) => {
      if (!cancelled) setProtectedFiles(new Set(found.filter((f): f is File => f !== null)));
    });
    return () => {
      cancelled = true;
    };
  }, [set, resolve]);
  /** Like `resolve`, but only files that can be decoded. */
  const usable = useMemo(
    () => (clip: AlsAudioClip) => {
      const f = resolve(clip);
      return f && !protectedFiles.has(f) ? f : null;
    },
    [resolve, protectedFiles],
  );
  const rows = useMemo(
    () => (set ? buildRows(set, setName, resolve, (f) => protectedFiles.has(f)) : []),
    [set, setName, resolve, protectedFiles],
  );
  const autoExports = useMemo(
    () => (set && als ? matchExports(files, als, set, setName, rows.map((r) => r.track), resolve) : new Map<string, File>()),
    [files, als, set, setName, rows, resolve],
  );
  const exportFor = (trackId: string): File | null =>
    exportOverrides.has(trackId) ? exportOverrides.get(trackId)! : autoExports.get(trackId) ?? null;
  const isChecked = (row: ImportRow): boolean =>
    tickOverrides.get(row.track.id) ?? (!row.muted && (row.playableCount > 0 || !!exportFor(row.track.id)));

  useEffect(() => {
    if (!als) return;
    let cancelled = false;
    callAudioWorker('parseAls', [als.file])
      .then((parsed) => {
        if (cancelled) return;
        setSet(parsed);
        setTickOverrides(new Map());
        setExportOverrides(new Map());
        setMixedGroups(new Set());
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(`Couldn't read ${als.file.name}: ${e instanceof Error ? e.message : String(e)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [als]);

  const toggle = (row: ImportRow) =>
    setTickOverrides((prev) => new Map(prev).set(row.track.id, !isChecked(row)));

  const setExport = (trackId: string, file: File | null) => {
    setExportOverrides((prev) => new Map(prev).set(trackId, file));
    if (file) setTickOverrides((prev) => new Map(prev).set(trackId, true));
  };

  const onRowDrop = async (e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const dropped = await collectDroppedFiles(e.dataTransfer);
    const audio = dropped.find((f) => isAudioFile(f.file.name));
    if (audio) setExport(trackId, audio.file);
  };

  const onAddFilesDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setAddingFiles(true);
    try {
      const dropped = await collectDroppedFiles(e.dataTransfer);
      setFiles((prev) => mergeFiles(prev, dropped));
    } finally {
      setAddingFiles(false);
    }
  };

  // Where the missing samples were, so the hint can say what to drop.
  const missingFolders = new Map<string, { count: number; nearby: boolean }>();
  if (set) {
    for (const row of rows) {
      if (exportFor(row.track.id)) continue;
      for (const clip of row.track.clips) {
        if (clip.disabled || resolve(clip)) continue;
        const { dir, nearby } = missingFolder(clip);
        missingFolders.set(dir, { count: (missingFolders.get(dir)?.count ?? 0) + 1, nearby });
      }
    }
  }

  // Effects that won't be heard: on tracks being rendered, their groups, and master.
  const selected = rows.filter(isChecked);
  const skippedEffects: string[] = [];
  const seenGroups = new Set<string>();
  for (const r of selected) {
    if (r.track.devices.length && !exportFor(r.track.id)) {
      skippedEffects.push(`${r.label}: ${r.track.devices.join(', ')}`);
    }
    if (r.group && !seenGroups.has(r.group.id)) {
      seenGroups.add(r.group.id);
      if (r.group.devices.length) skippedEffects.push(`${r.group.name} group: ${r.group.devices.join(', ')}`);
    }
  }
  if (set?.masterDevices.length) skippedEffects.push(`Master: ${set.masterDevices.join(', ')}`);

  // Groups with at least one ticked track can be mixed down to one stem.
  const groupsInUse: { group: AlsTrack; rows: ImportRow[] }[] = [];
  for (const row of selected) {
    if (!row.group) continue;
    const entry = groupsInUse.find((g) => g.group.id === row.group!.id);
    if (entry) entry.rows.push(row);
    else groupsInUse.push({ group: row.group, rows: [row] });
  }

  /**
   * How a mixed group handles pan. The player pans a stem only when it
   * plays as mono, so pan normally goes to the mixer instead of the audio.
   * Tracks panned differently from each other can't share one mixer pan,
   * so only then are their pans baked into a stereo mix.
   */
  const groupPan = (group: AlsTrack, members: ImportRow[]) => {
    const pans = members.map((r) => (exportFor(r.track.id) ? 0 : r.track.pan));
    if (pans.some((p) => Math.abs(p - pans[0]) > 1e-3)) return { bake: true, pan: 0 };
    return { bake: false, pan: Math.max(-1, Math.min(1, pans[0] + group.pan)) };
  };

  const stemCount =
    selected.filter((r) => !(r.group && mixedGroups.has(r.group.id))).length +
    groupsInUse.filter((g) => mixedGroups.has(g.group.id)).length;

  const runImport = async () => {
    if (!set) return;
    setError(null);
    const tempo = new TempoMap(set.tempo);
    const endBeat = Math.max(0, ...selected.filter((r) => !exportFor(r.track.id)).map((r) => r.endBeat));
    let lengthSec = tempo.beatToSec(endBeat);

    // One unit per stem: a single track, or a whole group mixed down. Units
    // keep the set's track order, with a mixed group where its first track was.
    type Unit = { kind: 'track'; row: ImportRow } | { kind: 'mix'; group: AlsTrack; rows: ImportRow[] };
    const units: Unit[] = [];
    for (const row of selected) {
      if (row.group && mixedGroups.has(row.group.id)) {
        const unit = units.find((u) => u.kind === 'mix' && u.group.id === row.group!.id);
        if (unit && unit.kind === 'mix') unit.rows.push(row);
        else units.push({ kind: 'mix', group: row.group, rows: [row] });
      } else {
        units.push({ kind: 'track', row });
      }
    }

    /** A finished stem's audio plus the mixer level and pan it should play at. */
    const renderRow = async (row: ImportRow) => {
      const exported = exportFor(row.track.id);
      if (exported) {
        // Ableton exports are post-fader, so they play at unity, centered.
        const buffer = await decodeSource(exported, RENDER_SAMPLE_RATE);
        lengthSec = Math.max(lengthSec, buffer.duration);
        return { buffer, file: exported, volume: 1, pan: 0 };
      }
      const rendered = await renderTrack(row.track, tempo, lengthSec, usable);
      return {
        buffer: rendered.buffer,
        file: rendered.file,
        volume: (rendered.automationPeak ?? row.track.volume) * rendered.headroomGain,
        pan: row.track.pan,
      };
    };

    try {
      const taken = new Set<string>();
      const stems: StemEntry[] = [];
      const groups = new Map<string, StemGroupConfig>();
      const mixerOrder: string[] = [];
      let step = 0;

      for (const unit of units) {
        const color = palette[stems.length % palette.length];
        if (unit.kind === 'mix') {
          // The sum is held and built in the worker, one track at a time.
          const mixId = newMixId();
          await callAudioWorker('mixStart', [mixId, Math.ceil(lengthSec * RENDER_SAMPLE_RATE), RENDER_SAMPLE_RATE]);
          const pan = groupPan(unit.group, unit.rows);
          try {
            for (const row of unit.rows) {
              setProgress(`Rendering ${++step} of ${selected.length}: ${row.label} (into ${unit.group.name})`);
              const exported = exportFor(row.track.id);
              if (exported) {
                // Exports are post-fader: unity gain, centered.
                const buffer = await decodeSource(exported, RENDER_SAMPLE_RATE);
                await callAudioWorker('mixAdd', [mixId, pcmFromAudioBuffer(buffer), 1, 0]);
              } else {
                const raw = await renderTrackPcm(row.track, tempo, lengthSec, usable);
                const volume = raw.automationPeak ?? row.track.volume;
                await callAudioWorker('mixAdd', [mixId, raw.pcm, volume, pan.bake ? row.track.pan : 0]);
              }
            }
          } catch (e) {
            void callAudioWorker('mixCancel', [mixId]);
            throw e;
          }
          setProgress(`Mixing ${unit.group.name}`);
          const mixed = await callAudioWorker('mixFinish', [mixId]);
          const label = cleanTrackLabel(unit.group.name, setName);
          const id = uniqueId(kebab(label), taken);
          const buffer = pcmToAudioBuffer(mixed.pcm);
          const channels = buffer.numberOfChannels;
          stems.push({
            file: new File([mixed.wav], `${id}.wav`, { type: 'audio/wav' }), id, label, color,
            defaultVolume: clampVolume(unit.group.volume * mixed.headroomGain),
            defaultPan: pan.pan,
            channels, stereo: pan.bake || (channels > 1 && pan.pan === 0),
            offsetSec: 0, buffer,
          });
          mixerOrder.push(id);
          continue;
        }

        const { row } = unit;
        setProgress(`Rendering ${++step} of ${selected.length}: ${row.label}`);
        const id = uniqueId(kebab(row.label), taken);
        const part = await renderRow(row);
        const channels = part.buffer.numberOfChannels;
        stems.push({
          file: new File([part.file], `${id}${part.file.name.match(/\.[^.]+$/)?.[0] ?? '.wav'}`, { type: part.file.type || 'audio/wav' }), id, label: row.label, color,
          defaultVolume: clampVolume(part.volume),
          defaultPan: part.pan,
          // A panned track plays as mono so the mixer can pan it; the file
          // keeps its channels, so it can still be switched to stereo.
          channels, stereo: channels > 1 && part.pan === 0,
          offsetSec: 0, buffer: part.buffer,
        });

        // Unmixed groups stay groups, at the position of their first track.
        if (!row.group) {
          mixerOrder.push(id);
          continue;
        }
        let group = groups.get(row.group.id);
        if (!group) {
          group = {
            id: uniqueId(kebab(row.group.name) || 'group', taken),
            label: row.group.name,
            color: palette[groups.size % palette.length],
            stemIds: [],
            defaultVolume: clampVolume(row.group.volume),
          };
          groups.set(row.group.id, group);
          mixerOrder.push(group.id);
        }
        group.stemIds.push(id);
      }

      const timing = buildTiming(set, endBeat);
      dispatch({
        type: 'IMPORT_ABLETON',
        stems,
        durationSeconds: Math.round(lengthSec * 100) / 100,
        groups: [...groups.values()],
        mixerOrder,
        ...timing,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  const chooseSet = (path: string | null) => {
    setSet(null);
    setError(null);
    setAlsPath(path);
  };

  if (!als) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-lg font-medium">Which Ableton set?</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-sm">
            Cancel
          </button>
        </div>
        <p className="text-sm text-gray-400">
          The drop has {sets.length} sets. Samples are found anywhere in the drop, so dropping a parent
          folder with shared sample folders in it works.
        </p>
        <ul className="max-h-80 overflow-y-auto space-y-1">
          {sets.map((f) => (
            <li key={f.path}>
              <button
                onClick={() => chooseSet(f.path)}
                className="w-full text-left px-3 py-1.5 rounded bg-gray-900/60 hover:bg-gray-700 text-sm"
              >
                {setNameFromFile(f.file.name)}
                <span className="ml-2 text-xs text-gray-500">{f.path}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (error && !set) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 space-y-3">
        <p className="text-red-400 text-sm">{error}</p>
        <button onClick={onClose} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm">
          Close
        </button>
      </div>
    );
  }
  if (!set) return <p className="text-gray-400 text-sm">Reading {als.file.name}...</p>;

  const firstMeter = set.timeSignatures[0];
  const missingEntries = [...missingFolders];
  const nearbyMissing = missingEntries.filter(([, m]) => m.nearby);
  const elsewhereMissing = missingEntries.filter(([, m]) => !m.nearby);
  const missingCount = missingEntries.reduce((n, [, m]) => n + m.count, 0);

  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-lg font-medium">Import Ableton set: {setName}</h3>
          <p className="text-xs text-gray-400">
            {set.creator}, {set.tempo[0]?.value} BPM
            {set.tempo.length > 1 ? ' (with tempo changes)' : ''}
            {firstMeter ? `, ${firstMeter.numerator}/${firstMeter.denominator}` : ''}, {set.locators.length} locators
          </p>
        </div>
        <div className="flex gap-3">
          {sets.length > 1 && (
            <button onClick={() => chooseSet(null)} disabled={!!progress} className="text-gray-500 hover:text-gray-300 text-sm">
              Other set
            </button>
          )}
          <button onClick={onClose} disabled={!!progress} className="text-gray-500 hover:text-gray-300 text-sm">
            Cancel
          </button>
        </div>
      </div>

      <p className="text-sm text-gray-400">
        Each ticked track is rendered from its arrangement clips, with clip edits, loops, gain, fades and
        volume automation applied. To keep a track's effects, drop its file from Ableton's Export All
        Individual Tracks onto the row.
      </p>

      {missingFolders.size > 0 && (
        <div className="rounded-lg border-2 border-amber-500 bg-amber-500/10 p-4 space-y-2">
          <p className="text-base font-semibold text-amber-300">
            {missingCount} {missingCount === 1 ? 'clip has' : 'clips have'} no audio in this drop. Run Collect All and Save in Ableton first.
          </p>
          <ol className="list-decimal pl-5 text-sm text-amber-100 space-y-0.5">
            <li>Open {als.file.name} in Ableton.</li>
            <li>
              Choose <span className="font-semibold">File &gt; Collect All and Save</span>.
            </li>
            <li>When Live asks which samples to collect, choose Yes for every option.</li>
            <li>Drop the project folder here again.</li>
          </ol>
          <p className="text-xs text-amber-200/80">
            This copies every sample the set uses into its project folder, including ones that only exist on
            the computer that made it. It's the only fix for those.
          </p>
          {elsewhereMissing.length > 0 && (
            <details className="text-xs text-amber-200/80">
              <summary className="cursor-pointer">Folders not in this drop ({elsewhereMissing.length})</summary>
              <ul className="list-disc pl-5 font-mono mt-1">
                {elsewhereMissing.map(([dir, { count }]) => (
                  <li key={dir}>
                    {dir} ({count} {count === 1 ? 'clip' : 'clips'})
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {rows.length === 0 && <p className="text-sm text-gray-400">No audio tracks with arrangement clips.</p>}

      <div className="space-y-2">
        {rows.map((row) => {
          const exported = exportFor(row.track.id);
          const usable = row.playableCount > 0 || !!exported;
          return (
            <div
              key={row.track.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onRowDrop(e, row.track.id)}
              className="bg-gray-900/60 rounded p-2 text-sm space-y-1"
            >
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isChecked(row) && usable}
                  disabled={!usable || !!progress}
                  onChange={() => toggle(row)}
                  className="accent-blue-500"
                />
                <span className="font-medium">{row.label}</span>
                {row.group && <span className="text-xs text-gray-500">in {row.group.name}</span>}
                {row.muted && <span className="text-xs text-yellow-500">muted in Ableton</span>}
                <span className="ml-auto text-xs text-gray-500">
                  {exported ? (
                    <>
                      using export {exported.name}{' '}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          setExport(row.track.id, null);
                        }}
                        className="text-gray-500 hover:text-red-400"
                        aria-label="Stop using export"
                      >
                        &times;
                      </button>
                    </>
                  ) : (
                    `${row.playableCount} of ${row.track.clips.length} ${row.track.clips.length === 1 ? 'clip' : 'clips'}`
                  )}
                </span>
              </label>
              {!exported && row.missing.length > 0 && (
                <p className="text-xs text-red-400 pl-7">Missing: {row.missing.join(', ')}</p>
              )}
              {!exported && row.protectedFiles.length > 0 && (
                <p className="text-xs text-red-400 pl-7">
                  Encrypted Ableton Pack audio, which only Ableton can play: {row.protectedFiles.join(', ')}.{' '}
                  {row.playableCount > 0 ? 'Those clips will be silent. ' : ''}
                  In Ableton, select the clip and Consolidate it (Cmd+J), then drop the project again. Or export
                  this track and drop the file on this row.
                </p>
              )}
              {!exported && row.track.devices.length > 0 && (
                <p className="text-xs text-gray-500 pl-7">Effects not rendered: {row.track.devices.join(', ')}</p>
              )}
              {!exported &&
                [...new Set(row.warnings)].map((w) => (
                  <p key={w} className="text-xs text-yellow-500 pl-7">{w}</p>
                ))}
            </div>
          );
        })}
      </div>

      {nearbyMissing.length > 0 && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onAddFilesDrop}
          className="border-2 border-dashed border-gray-600 rounded-lg p-3 text-xs text-gray-400 space-y-1"
        >
          <p className="text-gray-300">
            {addingFiles
              ? 'Adding files...'
              : 'Or, if these folders are on this computer, drop them here (or drop the folder that holds the project and them together):'}
          </p>
          <ul className="list-disc pl-5 font-mono">
            {nearbyMissing.map(([dir, { count }]) => (
              <li key={dir}>
                {dir} <span className="text-gray-500">({count} {count === 1 ? 'clip' : 'clips'})</span>
              </li>
            ))}
          </ul>
          <p>Paths starting with ../ are relative to the project folder.</p>
        </div>
      )}

      {groupsInUse.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm text-gray-300">Groups</p>
          {groupsInUse.map(({ group, rows: members }) => (
            <label key={group.id} className="flex items-start gap-3 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={mixedGroups.has(group.id)}
                disabled={!!progress}
                onChange={() =>
                  setMixedGroups((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.id)) next.delete(group.id);
                    else next.add(group.id);
                    return next;
                  })
                }
                className="accent-blue-500 mt-1"
              />
              <span>
                Mix {group.name} into one stem
                <span className="block text-xs text-gray-500">
                  {mixedGroups.has(group.id)
                    ? `${members.map((m) => m.label).join(', ')} become one stem at each track's Ableton volume. ${groupPan(group, members).bake ? 'Their pans differ, so they are baked into a stereo stem.' : 'Pan goes to the mixer.'} Brief peaks over full scale are limited, like a group Limiter in Ableton`
                    : `${members.length} separate ${members.length === 1 ? 'stem' : 'stems'} in a ${group.name} mixer group`}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      {skippedEffects.length > 0 && (
        <div className="text-xs text-gray-400">
          <p className="text-gray-300">Effects that won't be heard:</p>
          <ul className="list-disc pl-5">
            {skippedEffects.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </div>
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={runImport}
          disabled={selected.length === 0 || !!progress}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm"
        >
          Import {stemCount} {stemCount === 1 ? 'stem' : 'stems'}
        </button>
        {progress && <span className="text-sm text-gray-400">{progress}</span>}
      </div>
    </div>
  );
}
