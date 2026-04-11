import { useState, useRef, useCallback } from 'react';

type StepStatus = 'idle' | 'running' | 'pass' | 'fail' | 'skip';

interface Step {
  label: string;
  status: StepStatus;
  detail: string;
}

const INITIAL_STEPS: Step[] = [
  { label: '1. Create AudioContext', status: 'idle', detail: '' },
  { label: '2. Resume AudioContext (user gesture)', status: 'idle', detail: '' },
  { label: '3. Decode audio file', status: 'idle', detail: '' },
  { label: '4. Play raw at 1x (no pitch correction)', status: 'idle', detail: '' },
  { label: '5. Detect pitch correction path', status: 'idle', detail: '' },
  { label: '6. Register/init pitch corrector', status: 'idle', detail: '' },
  { label: '7. Play at 1x with pitch correction', status: 'idle', detail: '' },
  { label: '8. Play at 0.5x with pitch correction', status: 'idle', detail: '' },
];

export function MobileAudioDiag({ sampleUrl = '/audio-samples/drum-sample.opus' }: { sampleUrl?: string }) {
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [running, setRunning] = useState(false);
  const [ua, setUa] = useState('');
  const [activePath, setActivePath] = useState<'unknown' | 'AudioWorklet' | 'ScriptProcessorNode'>('unknown');
  const ctxRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const update = (idx: number, status: StepStatus, detail: string) => {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, status, detail } : s));
  };

  const stopSource = () => {
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch {}
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
  };

  const playBuffer = (ctx: AudioContext, buffer: AudioBuffer, rate: number, seconds: number, dest?: AudioNode): Promise<void> => {
    return new Promise((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      src.connect(dest ?? ctx.destination);
      src.start(0, 0);
      sourceRef.current = src;
      const timer = setTimeout(() => { stopSource(); resolve(); }, seconds * 1000);
      src.onended = () => { clearTimeout(timer); resolve(); };
    });
  };

  const runDiag = useCallback(async () => {
    setRunning(true);
    setSteps(INITIAL_STEPS);
    setUa(navigator.userAgent);
    stopSource();

    // Step 1: Create AudioContext
    update(0, 'running', '');
    try {
      if (!ctxRef.current) {
        ctxRef.current = new AudioContext();
      }
      const ctx = ctxRef.current;
      update(0, 'pass', `state=${ctx.state}, sampleRate=${ctx.sampleRate}`);
    } catch (e: any) {
      update(0, 'fail', e.message);
      setRunning(false);
      return;
    }

    const ctx = ctxRef.current!;

    // Step 2: Resume
    update(1, 'running', '');
    try {
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      update(1, 'pass', `state=${ctx.state}`);
    } catch (e: any) {
      update(1, 'fail', e.message);
      setRunning(false);
      return;
    }

    // Step 3: Decode
    update(2, 'running', `fetching ${sampleUrl}`);
    try {
      const resp = await fetch(sampleUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const ab = await resp.arrayBuffer();
      update(2, 'running', `decoding ${ab.byteLength} bytes...`);
      const buf = await ctx.decodeAudioData(ab);
      bufferRef.current = buf;
      update(2, 'pass', `${buf.numberOfChannels}ch, ${buf.sampleRate}Hz, ${buf.duration.toFixed(1)}s, ${(buf.length * buf.numberOfChannels * 4 / 1024 / 1024).toFixed(1)} MB PCM`);
    } catch (e: any) {
      update(2, 'fail', e.message);
      setRunning(false);
      return;
    }

    // Step 4: Raw playback at 1x
    update(3, 'running', 'playing 2s raw at 1x...');
    try {
      await playBuffer(ctx, bufferRef.current!, 1.0, 2);
      update(3, 'pass', 'played 2s — if silent, check mute switch and volume');
    } catch (e: any) {
      update(3, 'fail', e.message);
      setRunning(false);
      return;
    }

    const hasWorklet = typeof AudioWorkletNode !== 'undefined';
    const path = hasWorklet ? 'AudioWorklet' as const : 'ScriptProcessorNode' as const;
    setActivePath(path);
    update(4, 'pass', `${path} — ${hasWorklet ? 'AudioWorklet available, using worklet path' : 'AudioWorkletNode missing, using ScriptProcessorNode fallback'}`);

    if (hasWorklet) {
      // ---- AudioWorklet path ----
      update(5, 'running', 'registering AudioWorklet...');
      try {
        const { SoundTouchNode } = await import('@soundtouchjs/audio-worklet');
        await SoundTouchNode.register(ctx, '/soundtouch-processor.js');
        update(5, 'pass', 'SoundTouch AudioWorklet registered');

        update(6, 'running', 'playing 2s via AudioWorklet at 1x...');
        try {
          const stNode = new SoundTouchNode(ctx);
          stNode.playbackRate.value = 1.0;
          stNode.connect(ctx.destination);
          await playBuffer(ctx, bufferRef.current!, 1.0, 2, stNode);
          stNode.disconnect();
          update(6, 'pass', 'played 2s via AudioWorklet SoundTouch at 1x');
        } catch (e: any) {
          update(6, 'fail', e.message);
          setRunning(false);
          return;
        }

        update(7, 'running', 'playing 3s via AudioWorklet at 0.5x...');
        try {
          const stNode = new SoundTouchNode(ctx);
          stNode.playbackRate.value = 0.5;
          stNode.connect(ctx.destination);
          await playBuffer(ctx, bufferRef.current!, 0.5, 3, stNode);
          stNode.disconnect();
          update(7, 'pass', 'played 3s via AudioWorklet SoundTouch at 0.5x (pitch-corrected)');
        } catch (e: any) {
          update(7, 'fail', e.message);
        }
      } catch (e: any) {
        update(5, 'fail', e.message);
        update(6, 'skip', 'skipped — worklet failed');
        update(7, 'skip', 'skipped — worklet failed');
      }
    } else {
      // ---- ScriptProcessorNode fallback path ----
      update(5, 'running', 'initializing ScriptProcessorNode fallback...');
      try {
        const { SoundTouch } = await import('@soundtouchjs/core');
        const pipe = new SoundTouch();
        const bufferSize = 4096;
        const processor = ctx.createScriptProcessor(bufferSize, 2, 2);
        const samples = new Float32Array(bufferSize * 2);
        const outputSamples = new Float32Array(bufferSize * 2);
        let currentRate = 1.0;

        processor.onaudioprocess = (e: AudioProcessingEvent) => {
          const leftIn = e.inputBuffer.getChannelData(0);
          const rightIn = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : leftIn;
          const leftOut = e.outputBuffer.getChannelData(0);
          const rightOut = e.outputBuffer.numberOfChannels > 1 ? e.outputBuffer.getChannelData(1) : leftOut;
          const frames = leftIn.length;
          pipe.pitch = 1 / currentRate;
          for (let i = 0; i < frames; i++) {
            samples[i * 2] = leftIn[i];
            samples[i * 2 + 1] = rightIn[i];
          }
          pipe.inputBuffer.putSamples(samples, 0, frames);
          pipe.process();
          const avail = pipe.outputBuffer.frameCount;
          const toExtract = Math.min(avail, frames);
          if (toExtract > 0) {
            pipe.outputBuffer.receiveSamples(outputSamples, toExtract);
            for (let i = 0; i < toExtract; i++) {
              const l = outputSamples[i * 2];
              const r = outputSamples[i * 2 + 1];
              leftOut[i] = Number.isFinite(l) ? l : 0;
              rightOut[i] = Number.isFinite(r) ? r : 0;
            }
          }
          for (let i = toExtract; i < frames; i++) {
            leftOut[i] = 0;
            rightOut[i] = 0;
          }
        };

        update(5, 'pass', 'ScriptProcessorNode + SoundTouch core initialized');

        update(6, 'running', 'playing 2s via ScriptProcessorNode at 1x...');
        try {
          currentRate = 1.0;
          processor.connect(ctx.destination);
          await playBuffer(ctx, bufferRef.current!, 1.0, 2, processor);
          processor.disconnect();
          update(6, 'pass', 'played 2s via ScriptProcessorNode fallback at 1x');
        } catch (e: any) {
          update(6, 'fail', e.message);
          setRunning(false);
          return;
        }

        update(7, 'running', 'playing 3s via ScriptProcessorNode at 0.5x...');
        try {
          currentRate = 0.5;
          processor.connect(ctx.destination);
          await playBuffer(ctx, bufferRef.current!, 0.5, 3, processor);
          processor.disconnect();
          update(7, 'pass', 'played 3s via ScriptProcessorNode fallback at 0.5x (pitch-corrected)');
        } catch (e: any) {
          update(7, 'fail', e.message);
        }
      } catch (e: any) {
        update(5, 'fail', e.message);
        update(6, 'skip', 'skipped — fallback init failed');
        update(7, 'skip', 'skipped — fallback init failed');
      }
    }

    setRunning(false);
  }, [sampleUrl]);

  const s = {
    container: {
      background: '#1a1a2e',
      borderRadius: '12px',
      border: '1px solid #2A2A2C',
      padding: '1.25rem',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      maxWidth: '520px',
      margin: '0 auto',
    },
    ua: {
      fontSize: '0.65rem',
      color: '#555',
      marginBottom: '0.75rem',
      wordBreak: 'break-all' as const,
      lineHeight: 1.4,
    },
    btn: {
      width: '100%',
      padding: '0.75rem',
      border: 'none',
      borderRadius: '8px',
      background: running ? '#555' : '#7B68EE',
      color: '#fff',
      cursor: running ? 'not-allowed' : 'pointer',
      fontSize: '1rem',
      fontWeight: 600,
      marginBottom: '0.75rem',
    },
    step: {
      display: 'flex',
      gap: '0.5rem',
      alignItems: 'flex-start',
      padding: '0.4rem 0',
      borderBottom: '1px solid #2A2A2C',
    },
    icon: (status: StepStatus) => ({
      flexShrink: 0,
      width: '1.5rem',
      textAlign: 'center' as const,
      fontSize: '0.8rem',
      fontWeight: 700,
      color: status === 'pass' ? '#4ade80'
        : status === 'fail' ? '#f87171'
        : status === 'running' ? '#facc15'
        : status === 'skip' ? '#D4A843'
        : '#555',
    }),
    label: {
      fontSize: '0.85rem',
      color: '#E0DED8',
      fontWeight: 500,
    },
    detail: {
      fontSize: '0.72rem',
      color: '#808080',
      marginTop: '2px',
      wordBreak: 'break-all' as const,
    },
  };

  const icons: Record<StepStatus, string> = { idle: '-', running: '...', pass: 'OK', fail: 'X', skip: '--' };

  return (
    <div style={s.container}>
      <button style={s.btn} onClick={runDiag} disabled={running}>
        {running ? 'Running diagnostics...' : 'Run Mobile Audio Diagnostics'}
      </button>
      {activePath !== 'unknown' && (
        <div style={{
          padding: '0.5rem 0.75rem',
          marginBottom: '0.75rem',
          borderRadius: '6px',
          fontSize: '0.85rem',
          fontWeight: 600,
          background: activePath === 'AudioWorklet' ? 'rgba(74, 222, 128, 0.15)' : 'rgba(212, 168, 67, 0.15)',
          color: activePath === 'AudioWorklet' ? '#4ade80' : '#D4A843',
          border: `1px solid ${activePath === 'AudioWorklet' ? 'rgba(74, 222, 128, 0.3)' : 'rgba(212, 168, 67, 0.3)'}`,
        }}>
          Active path: {activePath}
        </div>
      )}
      {ua && <div style={s.ua}>{ua}</div>}
      {steps.map((step, i) => (
        <div key={i} style={s.step}>
          <span style={s.icon(step.status)}>{icons[step.status]}</span>
          <div>
            <div style={s.label}>{step.label}</div>
            {step.detail && <div style={s.detail}>{step.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
