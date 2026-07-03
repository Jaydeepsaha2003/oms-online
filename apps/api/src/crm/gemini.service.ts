import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { AiConfigStatus, VoiceChecklistResult } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';

// Config key kept as-is for backward compatibility with rows saved before the
// Gemini → Groq migration (the stored API key lives under this key).
const CONFIG_KEY = 'GEMINI_CONFIG';
// Free-tier Groq model, current as of 2026-07 (Groq's recommended replacement
// for the deprecated llama-3.3-70b-versatile). Reliable with JSON-object mode.
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

interface GeminiConfig {
  apiKey: string;
  model: string;
}

/** A stored model left over from the Gemini days (e.g. "gemini-2.0-flash") is
 *  not a valid Groq model and would make every request fail — ignore it. */
function isGroqModel(model: string): boolean {
  return !!model && !/^gemini/i.test(model);
}

/**
 * Groq client for CRM voice notes.
 * Uses Whisper-Large-v3 for transcription and gpt-oss-120b for structuring — both free tier.
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
    const storedModel = (cfg.model || process.env.GROQ_MODEL || '').trim();
    return {
      apiKey: (cfg.apiKey || process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || '').trim(),
      model: isGroqModel(storedModel) ? storedModel : DEFAULT_MODEL,
    };
  }

  /** Config status for the Settings UI — never leaks the key itself. */
  async status(): Promise<AiConfigStatus> {
    const cfg = await this.readConfig();
    return { configured: !!cfg.apiKey, model: cfg.model };
  }

  async saveConfig(input: { apiKey?: string; model?: string }): Promise<AiConfigStatus> {
    const cur = await this.readConfig();
    const apiKey = input.apiKey === undefined ? cur.apiKey : input.apiKey.trim();
    const requested = (input.model || cur.model || '').trim();
    const model = isGroqModel(requested) ? requested : DEFAULT_MODEL;
    const value = JSON.stringify({ apiKey, model });
    await this.prisma.appConfig.upsert({ where: { key: CONFIG_KEY }, update: { value }, create: { key: CONFIG_KEY, value } });
    return { configured: !!apiKey, model };
  }

  /** Spoken note (base64 audio) → { transcript, summary, items[], detectedCustomer, detectedItem }. */
  async voiceToChecklist(audioBase64: string, mimeType: string): Promise<VoiceChecklistResult> {
    const { apiKey, model } = await this.readConfig();
    if (!apiKey) throw new BadRequestException('Voice input is not set up yet — add your Groq API key in Settings.');
    if (!audioBase64) throw new BadRequestException('No audio was received.');

    // 1. Transcribe the audio using Groq's Whisper-Large-v3 ASR endpoint
    const transcript = await this.transcribeAudio(audioBase64, mimeType, apiKey);
    if (!transcript) throw new BadRequestException('Could not transcribe audio note. Please try speaking louder or clearly.');

    // 2. Structuring using Groq's Llama model in JSON Mode
    const systemPrompt =
      'You are an assistant for a metal-utensil workshop manager in India. ' +
      'You will receive a transcript of a spoken note (Hindi, English, or Hinglish).\n' +
      'LANGUAGE RULE (very important): write "summary" and every "items" entry in HINGLISH — the ' +
      'casual Hindi-English mix a shopkeeper speaks, written in ROMAN (English/Latin) letters. ' +
      'Do NOT use Devanagari script, and do NOT translate the note into pure English. Keep common ' +
      'English words (order, ready, dispatch, payment, steel, glass, etc.) as English. If the ' +
      'transcript arrives in Devanagari, transliterate it to Roman letters.\n' +
      'Return a JSON object with these fields:\n' +
      '1. "transcript": the input transcript, transliterated to Roman/Hinglish letters if it was in Devanagari.\n' +
      '2. "summary": a brief one-line summary of the note, in Hinglish (Roman letters).\n' +
      '3. "items": an array of short, actionable checklist tasks, each written in Hinglish (Roman letters).\n' +
      '4. "detectedCustomer": the customer or party name mentioned in the transcript (string or null if not found).\n' +
      '5. "detectedItem": the product or item details mentioned in the transcript (string or null if not found).\n' +
      'Example of a good item: "Sharma ji ko 50 steel thali ka order ready hone ka bolna hai".\n' +
      'Return ONLY the raw JSON object. Do not wrap in markdown or add any extra text.';

    const chatBody = {
      model: model || DEFAULT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcript }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    };

    let chatRes: Response;
    try {
      chatRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(chatBody),
      });
    } catch {
      throw new ServiceUnavailableException('Could not reach Groq chat service. Check the server’s internet connection.');
    }

    if (!chatRes.ok) {
      const txt = await chatRes.text().catch(() => '');
      throw new ServiceUnavailableException(`Groq Chat API failed (${chatRes.status}): ${txt}`);
    }

    const chatJson = (await chatRes.json()) as { choices?: { message?: { content?: string } }[] };
    const resultText = chatJson.choices?.[0]?.message?.content ?? '';

    return this.parseResult(resultText, transcript);
  }

  private async transcribeAudio(audioBase64: string, mimeType: string, apiKey: string): Promise<string> {
    const buffer = Buffer.from(audioBase64, 'base64');
    let extension = 'wav';
    if (mimeType.includes('mp3')) extension = 'mp3';
    else if (mimeType.includes('m4a')) extension = 'm4a';
    else if (mimeType.includes('webm')) extension = 'webm';
    else if (mimeType.includes('ogg')) extension = 'ogg';

    const blob = new Blob([buffer], { type: mimeType || 'audio/wav' });
    const formData = new FormData();
    formData.append('file', blob, `recording.${extension}`);
    formData.append('model', 'whisper-large-v3');

    let res: Response;
    try {
      res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
        body: formData,
      });
    } catch {
      throw new ServiceUnavailableException('Could not reach Groq Whisper service.');
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new ServiceUnavailableException(`Groq Transcription failed (${res.status}): ${txt}`);
    }

    const json = (await res.json()) as { text?: string };
    return (json.text || '').trim();
  }

  private parseResult(text: string, originalTranscript: string): VoiceChecklistResult {
    let parsed: Partial<VoiceChecklistResult> = {};
    try {
      parsed = JSON.parse(text);
    } catch {
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
      transcript: parsed.transcript || originalTranscript || '',
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      items,
      detectedCustomer: typeof parsed.detectedCustomer === 'string' && parsed.detectedCustomer.trim() ? parsed.detectedCustomer.trim() : undefined,
      detectedItem: typeof parsed.detectedItem === 'string' && parsed.detectedItem.trim() ? parsed.detectedItem.trim() : undefined,
    };
  }
}
