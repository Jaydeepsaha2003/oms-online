/**
 * Mic → 16 kHz mono 16-bit WAV recorder, built on WebAudio (no MediaRecorder,
 * no deps). WAV is the format Gemini accepts everywhere, and this works on
 * Chrome/Edge, Firefox and iOS Safari (over HTTPS or localhost). Keep notes short.
 */
const TARGET_RATE = 16000;

type Ctx = typeof AudioContext;

export interface VoiceRecorder {
  stop: () => Promise<{ base64: string; mimeType: string }>;
  cancel: () => void;
}

export async function startVoiceRecording(): Promise<VoiceRecorder> {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new Error('Microphone access requires a secure connection (HTTPS or localhost).');
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone is not available on this device/browser.');
  }

  // Create AudioContext synchronously within user gesture context
  const AC: Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: Ctx }).webkitAudioContext;
  const ctx = new AC();
  const resumePromise = ctx.resume().catch(() => {});

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch (err) {
    console.warn('Detailed microphone constraints failed, falling back to simple audio constraints:', err);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (fallbackErr) {
      ctx.close().catch(() => {});
      throw fallbackErr;
    }
  }

  await resumePromise;
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      // Proceed best effort
    }
  }

  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (e) => {
    chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(ctx.destination);

  const teardown = () => {
    try { processor.disconnect(); } catch { /* */ }
    try { source.disconnect(); } catch { /* */ }
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  };

  return {
    cancel: teardown,
    stop: async () => {
      const inRate = ctx.sampleRate;
      teardown();
      const flat = flatten(chunks);
      const down = downsample(flat, inRate, TARGET_RATE);
      const wav = encodeWav(down, TARGET_RATE);
      return { base64: await blobToBase64(wav), mimeType: 'audio/wav' };
    },
  };
}

function flatten(chunks: Float32Array[]): Float32Array {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Float32Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

function downsample(buf: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return buf;
  const ratio = from / to;
  const outLen = Math.round(buf.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(buf.length, Math.floor((i + 1) * ratio));
    let sum = 0, n = 0;
    for (let j = start; j < end; j++) { sum += buf[j]; n++; }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

function encodeWav(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const w = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  w(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  w(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: 'audio/wav' });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read audio.'));
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.readAsDataURL(blob);
  });
}
