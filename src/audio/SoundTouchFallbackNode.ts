import { SoundTouch } from '@soundtouchjs/core';

/**
 * ScriptProcessorNode-based pitch corrector for browsers without AudioWorklet.
 * Same processing loop as the AudioWorklet processor, but runs on the main thread.
 */
export class SoundTouchFallbackNode {
  readonly audioNode: ScriptProcessorNode;
  private pipe: SoundTouch;
  private _playbackRate = 1.0;
  private samples: Float32Array;
  private outputSamples: Float32Array;

  constructor(ctx: AudioContext, bufferSize = 4096) {
    this.pipe = new SoundTouch();
    this.samples = new Float32Array(bufferSize * 2);
    this.outputSamples = new Float32Array(bufferSize * 2);

    this.audioNode = ctx.createScriptProcessor(bufferSize, 2, 2);
    this.audioNode.onaudioprocess = (e) => {
      const leftInput = e.inputBuffer.getChannelData(0);
      const rightInput = e.inputBuffer.numberOfChannels > 1
        ? e.inputBuffer.getChannelData(1)
        : leftInput;
      const leftOutput = e.outputBuffer.getChannelData(0);
      const rightOutput = e.outputBuffer.numberOfChannels > 1
        ? e.outputBuffer.getChannelData(1)
        : leftOutput;
      const frameCount = leftInput.length;

      // Ensure buffers are large enough
      if (this.samples.length < frameCount * 2) {
        this.samples = new Float32Array(frameCount * 2);
        this.outputSamples = new Float32Array(frameCount * 2);
      }

      // Pitch correction: compensate for source playbackRate change
      this.pipe.pitch = 1 / this._playbackRate;

      // Interleave input into SoundTouch format [L0, R0, L1, R1, ...]
      const samples = this.samples;
      for (let i = 0; i < frameCount; i++) {
        samples[i * 2] = leftInput[i];
        samples[i * 2 + 1] = rightInput[i];
      }

      // Push through SoundTouch
      this.pipe.inputBuffer.putSamples(samples, 0, frameCount);
      this.pipe.process();

      // Extract processed output
      const available = this.pipe.outputBuffer.frameCount;
      const toExtract = Math.min(available, frameCount);
      if (toExtract > 0) {
        const extracted = this.outputSamples;
        this.pipe.outputBuffer.receiveSamples(extracted, toExtract);
        for (let i = 0; i < toExtract; i++) {
          const l = extracted[i * 2];
          const r = extracted[i * 2 + 1];
          leftOutput[i] = Number.isFinite(l) ? l : 0;
          rightOutput[i] = Number.isFinite(r) ? r : 0;
        }
      }
      // Pad remainder with silence
      for (let i = toExtract; i < frameCount; i++) {
        leftOutput[i] = 0;
        rightOutput[i] = 0;
      }
    };
  }

  setPlaybackRate(rate: number): void {
    this._playbackRate = rate;
  }

  connect(dest: AudioNode): void {
    this.audioNode.connect(dest);
  }

  disconnect(): void {
    this.audioNode.disconnect();
  }
}
