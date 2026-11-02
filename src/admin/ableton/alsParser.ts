/**
 * Ableton Live Set (.als) parser.
 *
 * An .als file is gzipped XML. This reads the parts that matter for turning
 * an arrangement into stems: the tempo / meter automation on the master
 * track, locators, and every track's mixer, devices, automation and
 * arrangement audio clips. Session clips are ignored.
 *
 * Works against the DOM interface only (no querySelector), so it also runs
 * on @xmldom/xmldom: in the import worker, which has no DOMParser, and in
 * the Node smoke script.
 */

export interface AlsFileRef {
  /** Path relative to the project folder, e.g. `Samples/Imported/1.aif`. */
  relativePath: string;
  /** Absolute path on the machine that last saved the set. */
  path: string;
  /** File name, e.g. `1.aif`. */
  name: string;
}

export interface AlsWarpMarker {
  secTime: number;
  beatTime: number;
}

export interface AlsAudioClip {
  name: string;
  /** Arrangement position, in beats (quarter notes). */
  start: number;
  end: number;
  /** In clip beats when warped, in sample seconds when not. */
  loopStart: number;
  loopEnd: number;
  startRelative: number;
  loopOn: boolean;
  isWarped: boolean;
  warpMarkers: AlsWarpMarker[];
  /** Linear clip gain. */
  gain: number;
  /** Fade lengths, in arrangement beats. */
  fadeIn: number;
  fadeOut: number;
  /** Transpose in semitones (coarse + fine / 100). */
  pitch: number;
  disabled: boolean;
  hasClipEnvelopes: boolean;
  file: AlsFileRef;
}

export interface AlsAutomationPoint {
  beat: number;
  value: number;
}

export type AlsTrackKind = 'audio' | 'midi' | 'group' | 'return';

export interface AlsTrack {
  id: string;
  kind: AlsTrackKind;
  name: string;
  /** Id of the containing group track, or null at top level. */
  groupId: string | null;
  /** Linear gain, 1 = 0 dB (Live's fader tops out near 1.995). */
  volume: number;
  pan: number;
  muted: boolean;
  /** Enabled devices on the track, in chain order. */
  devices: string[];
  volumeAutomation: AlsAutomationPoint[];
  panAutomation: AlsAutomationPoint[];
  clips: AlsAudioClip[];
}

export interface AlsTimeSignature {
  beat: number;
  numerator: number;
  denominator: number;
}

export interface AlsLocator {
  beat: number;
  name: string;
}

export interface AbletonSet {
  creator: string;
  tempo: AlsAutomationPoint[];
  timeSignatures: AlsTimeSignature[];
  locators: AlsLocator[];
  tracks: AlsTrack[];
  masterDevices: string[];
}

// --- DOM helpers ------------------------------------------------------

function children(el: Element, tag?: string): Element[] {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!tag || (n as Element).tagName === tag)) out.push(n as Element);
  }
  return out;
}

/** Walk a `/`-separated path of direct children. */
function find(el: Element | null | undefined, path: string): Element | null {
  let cur: Element | null = el ?? null;
  for (const part of path.split('/')) {
    if (!cur) return null;
    cur = children(cur, part)[0] ?? null;
  }
  return cur;
}

function attr(el: Element | null | undefined, path: string): string | null {
  const target = path ? find(el, path) : el;
  return target?.getAttribute('Value') ?? null;
}

function num(el: Element | null | undefined, path: string, fallback = 0): number {
  const v = attr(el, path);
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(el: Element | null | undefined, path: string): boolean {
  return attr(el, path) === 'true';
}

// --- Decoding ---------------------------------------------------------

/** Live encodes a meter as `(numerator - 1) + 99 * log2(denominator)`. */
export function decodeTimeSignature(value: number): { numerator: number; denominator: number } {
  return { numerator: (value % 99) + 1, denominator: 2 ** Math.floor(value / 99) };
}

/** Gunzip an .als file's bytes into its XML text. */
export async function gunzipAls(bytes: ArrayBuffer): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/** Live stores an automation's initial value at a far negative time; clamp it to 0. */
function automationEvents(env: Element): AlsAutomationPoint[] {
  const events = find(env, 'Automation/Events');
  if (!events) return [];
  return children(events)
    .map((e) => ({
      beat: Math.max(0, Number(e.getAttribute('Time'))),
      value: Number(e.getAttribute('Value')),
      raw: Number(e.getAttribute('Time')),
    }))
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.raw - b.raw)
    .map(({ beat, value }) => ({ beat, value }));
}

/** Envelopes on a track (or master), keyed by the automation target id. */
function envelopesById(track: Element): Map<string, AlsAutomationPoint[]> {
  const map = new Map<string, AlsAutomationPoint[]>();
  const list = find(track, 'AutomationEnvelopes/Envelopes');
  if (!list) return map;
  for (const env of children(list, 'AutomationEnvelope')) {
    const id = attr(env, 'EnvelopeTarget/PointeeId');
    if (id !== null) map.set(id, automationEvents(env));
  }
  return map;
}

function targetId(param: Element | null): string | null {
  return find(param, 'AutomationTarget')?.getAttribute('Id') ?? null;
}

function deviceName(device: Element): string {
  const user = attr(device, 'UserName');
  if (user) return user;
  if (device.tagName === 'PluginDevice') {
    const desc = find(device, 'PluginDesc');
    const info = desc ? children(desc)[0] : null;
    return attr(info, 'PlugName') ?? attr(info, 'Name') ?? 'Plugin';
  }
  if (device.tagName === 'AuPluginDevice') {
    return attr(device, 'PluginDesc/AuPluginInfo/Name') ?? 'Audio Unit';
  }
  return DEVICE_LABELS[device.tagName] ?? device.tagName;
}

const DEVICE_LABELS: Record<string, string> = {
  AudioEffectGroupDevice: 'Audio Effect Rack',
  InstrumentGroupDevice: 'Instrument Rack',
  Eq8: 'EQ Eight',
  Compressor2: 'Compressor',
  GlueCompressor: 'Glue Compressor',
  StereoGain: 'Utility',
  AutoFilter: 'Auto Filter',
  Reverb: 'Reverb',
  Delay: 'Delay',
  Echo: 'Echo',
  Limiter: 'Limiter',
};

function devices(chain: Element | null): string[] {
  const list = find(chain, 'DeviceChain/Devices');
  if (!list) return [];
  return children(list)
    .filter((d) => attr(d, 'On/Manual') !== 'false')
    .map(deviceName);
}

function parseClip(clip: Element): AlsAudioClip {
  const fileRef = find(clip, 'SampleRef/FileRef');
  const relativePath = attr(fileRef, 'RelativePath') ?? '';
  const path = attr(fileRef, 'Path') ?? '';
  const name = (path || relativePath).split('/').pop() ?? '';
  const markers = find(clip, 'WarpMarkers');
  const envelopes = find(clip, 'Envelopes/Envelopes');
  return {
    name: attr(clip, 'Name') ?? name,
    start: num(clip, 'CurrentStart'),
    end: num(clip, 'CurrentEnd'),
    loopStart: num(clip, 'Loop/LoopStart'),
    loopEnd: num(clip, 'Loop/LoopEnd'),
    startRelative: num(clip, 'Loop/StartRelative'),
    loopOn: bool(clip, 'Loop/LoopOn'),
    isWarped: bool(clip, 'IsWarped'),
    warpMarkers: markers
      ? children(markers, 'WarpMarker')
          .map((m) => ({
            secTime: Number(m.getAttribute('SecTime')),
            beatTime: Number(m.getAttribute('BeatTime')),
          }))
          .sort((a, b) => a.beatTime - b.beatTime)
      : [],
    gain: num(clip, 'SampleVolume', 1),
    fadeIn: bool(clip, 'Fade') ? num(clip, 'Fades/FadeInLength') : 0,
    fadeOut: bool(clip, 'Fade') ? num(clip, 'Fades/FadeOutLength') : 0,
    pitch: num(clip, 'PitchCoarse') + num(clip, 'PitchFine') / 100,
    disabled: bool(clip, 'Disabled'),
    hasClipEnvelopes: !!envelopes && children(envelopes).length > 0,
    file: { relativePath, path, name },
  };
}

const TRACK_KINDS: Record<string, AlsTrackKind> = {
  AudioTrack: 'audio',
  MidiTrack: 'midi',
  GroupTrack: 'group',
  ReturnTrack: 'return',
};

function parseTrack(track: Element): AlsTrack {
  const chain = find(track, 'DeviceChain');
  const mixer = find(chain, 'Mixer');
  const envs = envelopesById(track);
  const volId = targetId(find(mixer, 'Volume'));
  const panId = targetId(find(mixer, 'Pan'));
  const groupId = attr(track, 'TrackGroupId');
  const events = find(chain, 'MainSequencer/Sample/ArrangerAutomation/Events');
  return {
    id: track.getAttribute('Id') ?? '',
    kind: TRACK_KINDS[track.tagName],
    name: attr(track, 'Name/EffectiveName') ?? attr(track, 'Name/UserName') ?? '',
    groupId: groupId && groupId !== '-1' ? groupId : null,
    volume: num(mixer, 'Volume/Manual', 1),
    pan: num(mixer, 'Pan/Manual'),
    muted: attr(mixer, 'Speaker/Manual') === 'false',
    devices: devices(chain),
    volumeAutomation: (volId && envs.get(volId)) || [],
    panAutomation: (panId && envs.get(panId)) || [],
    clips: events ? children(events, 'AudioClip').map(parseClip) : [],
  };
}

export function parseAlsDocument(doc: Document): AbletonSet {
  const root = doc.documentElement;
  const set = find(root, 'LiveSet');
  if (!set) throw new Error('Not an Ableton Live Set (no LiveSet element)');

  const master = find(set, 'MasterTrack');
  const masterMixer = find(master, 'DeviceChain/Mixer');
  const masterEnvs = master ? envelopesById(master) : new Map<string, AlsAutomationPoint[]>();

  const tempoParam = find(masterMixer, 'Tempo');
  const tempoAuto = masterEnvs.get(targetId(tempoParam) ?? '') ?? [];
  const tempo = tempoAuto.length > 0 ? tempoAuto : [{ beat: 0, value: num(tempoParam, 'Manual', 120) }];

  const sigParam = find(masterMixer, 'TimeSignature');
  const sigAuto = masterEnvs.get(targetId(sigParam) ?? '') ?? [];
  const sigPoints = sigAuto.length > 0 ? sigAuto : [{ beat: 0, value: num(sigParam, 'Manual', 201) }];
  const timeSignatures = sigPoints.map((p) => ({ beat: p.beat, ...decodeTimeSignature(p.value) }));

  const locatorList = find(set, 'Locators/Locators');
  const locators = locatorList
    ? children(locatorList, 'Locator')
        .map((l) => ({ beat: num(l, 'Time'), name: attr(l, 'Name') ?? '' }))
        .sort((a, b) => a.beat - b.beat)
    : [];

  const trackList = find(set, 'Tracks');
  const tracks = trackList
    ? children(trackList).filter((t) => t.tagName in TRACK_KINDS).map(parseTrack)
    : [];

  return {
    creator: root.getAttribute('Creator') ?? '',
    tempo,
    timeSignatures,
    locators,
    tracks,
    masterDevices: devices(find(master, 'DeviceChain')),
  };
}
