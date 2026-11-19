// What the chat needs before voice code loads (M11): the language to listen in first, and audio unlocked on the
// visitor's own press, which iPhones require before anything may play.
import type { VoiceLanguage } from "@ucp/protocol/v1";

const REMEMBERED = "ucp-voice-language";

/** The visitor's last choice, else the first of their browser's languages the widget offers (exactly, then by
 *  language alone), else the widget's default. */
export function firstLanguage(offered: VoiceLanguage[], preferred: readonly string[], remembered: string | null): VoiceLanguage {
  if (remembered && (offered as string[]).includes(remembered)) return remembered as VoiceLanguage;
  for (const tag of preferred) {
    const exact = offered.find((code) => code.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
  }
  for (const tag of preferred) {
    const near = offered.find((code) => code.split("-")[0] === tag.split("-")[0]?.toLowerCase());
    if (near) return near;
  }
  return offered[0] as VoiceLanguage;
}

export function rememberedLanguage(): string | null {
  try {
    return localStorage.getItem(REMEMBERED); // a convenience: storage in a frame may be refused or wiped
  } catch {
    return null;
  }
}

export function rememberLanguage(code: VoiceLanguage) {
  try {
    localStorage.setItem(REMEMBERED, code);
  } catch {
    // forgotten next time, which is fine
  }
}

let context: AudioContext | undefined;

/** The one audio context, created and resumed inside the visitor's press. None where the browser has no Web Audio. */
export function unlockAudio(): AudioContext | undefined {
  if (typeof AudioContext === "undefined") return undefined;
  context ??= new AudioContext();
  void context.resume();
  return context;
}
