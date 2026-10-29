/**
 * Run a binary without blocking the event loop, and without a shell: every
 * argument is passed as-is, so an uploaded file's name can never become part
 * of a command. ffmpeg and MuseScore run for seconds to minutes; done
 * synchronously, they froze every other request — and Fly's health check —
 * until they finished.
 */
import { spawn } from 'node:child_process';

export interface RunResult {
  code: number | null;
  /** Everything it printed — empty when `onStdout` takes it instead. */
  stdout: string;
  /** The last ~256 KB — ffmpeg writes progress here for the whole run. */
  stderr: string;
}

const STDERR_KEEP = 256 * 1024;

/** Resolves when the process exits, whatever its status; rejects only if it can't start. */
export function run(
  bin: string,
  args: string[],
  opts: { timeoutMs?: number; onStdout?: (chunk: string) => void } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: opts.timeoutMs });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8').on('data', (chunk: string) => {
      if (opts.onStdout) opts.onStdout(chunk);
      else stdout += chunk;
    });
    child.stderr.setEncoding('utf-8').on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > STDERR_KEEP * 2) stderr = stderr.slice(-STDERR_KEEP);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr: stderr.slice(-STDERR_KEEP) }));
  });
}
