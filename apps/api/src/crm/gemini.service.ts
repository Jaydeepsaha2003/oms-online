import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { AiConfigStatus, VoiceChecklistResult } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';

const CONFIG_KEY = 'GEMINI_CONFIG';
const DEFAULT_MODEL = 'gemini-2.0-flash';

interface GeminiConfig {
  apiKey: string;
  model: string;
}

/**
 * Thin Google Gemini client. The API key lives ONLY on the server (AppConfig or
 * the GEMINI_API_KEY env var) — never sent to the browser. Turns a spoken note
 * (Hindi / English / mixed) into a structured checklist in one multimodal call.
 */
@Injectable()
export class GeminiService {
  constructor(private readonly prisma: PrismaService) {}

  private async readConfig(): Promise<GeminiConfig> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: CONFIG_KEY } });
    let cfg: Partial<GeminiConfig> = {};
    if (row?.value) {
      try {
        cfg = JSON.parse(row.value);
      } catch {
        /* ignore */
      }
    }
    return {
      apiKey: (cfg.apiKey || process.env.GEMINI_API_KEY || '').trim(),
      model: (cfg.model || process.env.GEMINI_MODEL || DEFAULT_MODEL).trim(),
    };
  }

  /** Config status for the Settings UI — never leaks the key itself. */
  async status(): Promise<AiConfigStatus> {
    const cfg = await this.readConfig();
    return { configured: !!cfg.apiKey, model: cfg.model };
  }

  async saveConfig(input: { apiKey?: string; model?: string }): Promise<AiConfigStatus> {
    const cur = await this.readConfig();
    // An empty apiKey means "clear it"; undefined means "leave unchanged".
    const apiKey = input.apiKey === undefined ? cur.apiKey : input.apiKey.trim();
    const model = (input.model || cur.model || DEFAULT_MODEL).trim();
    const value = JSON.stringify({ apiKey, model });
    await this.prisma.appConfig.upsert({ where: { key: CONFIG_KEY }, update: { value }, create: { key: CONFIG_KEY, value } });
    return { configured: !!apiKey, model };
  }

  /** Spoken note (base64 audio) → { transcript, summary, items[] }. */
  async voiceToChecklist(audioBase64: string, mimeType: string): Promise<VoiceChecklistResult> {
    const { apiKey, model } = await this.readConfig();
    if (!apiKey) throw new BadRequestException('Voice input is not set up yet — add your Gemini API key in Settings.');
    if (!audioBase64) throw new BadRequestException('No audio was received.');

    const prompt =
      'You are an assistant for a metal-utensil workshop manager in India. The audio is a quick spoken note in Hindi, English, or a mix (Hinglish). ' +
      'Do the following:\n' +
      '1. Transcribe it faithfully in the language spoken.\n' +
      '2. Write a one-line summary.\n' +
      '3. Break it into short, clear, actionable checklist tasks — one task per item, keeping party names, product names and dates, and write each item in the same language it was spoken.\n' +
      '4. If a customer or party name is mentioned in the note, identify and extract it into "detectedCustomer" (as a string or null).\n' +
      '5. If a product, item, or quantity details are mentioned, extract the key item details into "detectedItem" (as a string or null).\n' +
      'Return ONLY JSON with exactly these keys: {"transcript": string, "summary": string, "items": string[], "detectedCustomer": string | null, "detectedItem": string | null}. No markdown, no extra text.';

    const body = {
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType || 'audio/wav', data: audioBase64 } }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      throw new ServiceUnavailableException('Could not reach Gemini. Check the server’s internet connection.');
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      const msg = this.friendlyError(res.status, txt);
      throw new ServiceUnavailableException(msg);
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      promptFeedback?: { blockReason?: string };
    };
    if (json.promptFeedback?.blockReason) throw new BadRequestException('The note could not be processed (content filter). Please try again.');
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    return this.parseResult(text);
  }

  private parseResult(text: string): VoiceChecklistResult {
    let parsed: Partial<VoiceChecklistResult> = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      // Fallback: strip a ```json fence if the model added one.
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          parsed = JSON.parse(m[0]);
        } catch {
          /* ignore */
        }
      }
    }
    const items = Array.isArray(parsed.items) ? parsed.items.map((s) => String(s).trim()).filter(Boolean) : [];
    return {
      transcript: typeof parsed.transcript === 'string' ? parsed.transcript : '',
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      items,
      detectedCustomer: typeof parsed.detectedCustomer === 'string' && parsed.detectedCustomer.trim() ? parsed.detectedCustomer.trim() : undefined,
      detectedItem: typeof parsed.detectedItem === 'string' && parsed.detectedItem.trim() ? parsed.detectedItem.trim() : undefined,
    };
  }

  private friendlyError(status: number, body: string): string {
    if (status === 400 && /API key not valid/i.test(body)) return 'The Gemini API key is invalid — check it in Settings.';
    if (status === 403) return 'The Gemini API key was rejected (check it’s enabled for the Generative Language API).';
    if (status === 429) return 'Gemini is rate-limited right now — wait a moment and try again.';
    return `Gemini request failed (${status}). Please try again.`;
  }
}
