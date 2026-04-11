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
  { label: '5. Play raw at 0.5x (pitch drops — fallback path)', status: 'idle', detail: '' },
  { label: '6. Check AudioWorkletNode support', status: 'idle', detail: '' },
  { label: '7. Register SoundTouch AudioWorklet', status: 'idle', detail: '' },
  { label: '8. Play via SoundTouch at 1x', status: 'idle', detail: '' },
  { label: '9. Play via SoundTouch at 0.5x (pitch-corrected)', status: 'idle', detail: '' },
];

export function MobileAudioDiag({ sampleUrl = '/audio-samples/drum-sample.opus' }: { sampleUrl?: string }) {
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [running, setRunning] = useState(false);
  const [ua, setUa] = useState('');
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
      update(3, 'pass', 'played 2s — you should have heard audio');
    } catch (e: any) {
      update(3, 'fail', e.message);
      setRunning(false);
      return;
    }

    // Step 5: Raw playback at 0.5x (fallback path — pitch drops)
    update(4, 'running', 'playing 2s raw at 0.5x (pitch will drop)...');
    try {
      await playBuffer(ctx, bufferRef.current!, 0.5, 2);
      update(4, 'pass', 'played 2s at 0.5x — pitch dropped (this is the no-worklet fallback)');
    } catch (e: any) {
      update(4, 'fail', e.message);
      setRunning(false);
      return;
    }

    // Step 6: Check AudioWorkletNode
    update(5, 'running', 'checking typeof AudioWorkletNode...');
    const hasWorklet = typeof AudioWorkletNode !== 'undefined';
    if (hasWorklet) {
      update(5, 'pass', 'AudioWorkletNode is available');
    } else {
      update(5, 'fail', 'AudioWorkletNode is NOT available — SoundTouch cannot run on this browser. Fallback to raw playbackRate (step 5) is the only option.');
      update(6, 'skip', 'skipped — no AudioWorkletNode');
      update(7, 'skip', 'skipped — no AudioWorkletNode');
      update(8, 'skip', 'skipped — no AudioWorkletNode');
      setRunning(false);
      return;
    }

    // Step 7: Register SoundTouch worklet
    update(6, 'running', 'registering AudioWorklet...');
    try {
      const { SoundTouchNode } = await import('@soundtouchjs/audio-worklet');
      await SoundTouchNode.register(ctx, '/soundtouch-processor.js');
      update(6, 'pass', 'SoundTouch AudioWorklet registered');

      // Step 8: SoundTouch at 1x
      update(7, 'running', 'playing 2s via SoundTouch at 1x...');
      try {
        const stNode = new SoundTouchNode(ctx);
        stNode.playbackRate.value = 1.0;
        stNode.connect(ctx.destination);
        await playBuffer(ctx, bufferRef.current!, 1.0, 2, stNode);
        stNode.disconnect();
        update(7, 'pass', 'played 2s via SoundTouch at 1x');
      } catch (e: any) {
        update(7, 'fail', e.message);
        setRunning(false);
        return;
      }

      // Step 9: SoundTouch at 0.5x
      update(8, 'running', 'playing 3s via SoundTouch at 0.5x...');
      try {
        const stNode = new SoundTouchNode(ctx);
        stNode.playbackRate.value = 0.5;
        stNode.connect(ctx.destination);
        await playBuffer(ctx, bufferRef.current!, 0.5, 3, stNode);
        stNode.disconnect();
        update(8, 'pass', 'played 3s via SoundTouch at 0.5x (pitch-corrected)');
      } catch (e: any) {
        update(8, 'fail', e.message);
      }
    } catch (e: any) {
      update(6, 'fail', e.message);
      update(7, 'skip', 'skipped — worklet failed');
      update(8, 'skip', 'skipped — worklet failed');
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
