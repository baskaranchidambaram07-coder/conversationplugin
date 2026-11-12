// The one rule for a customer's brand colour, shared by the loader and the chat: only a six-digit hex colour is
// accepted, and text or icons on it are white or black, whichever contrasts more (DESIGN.md).

export const isColor = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

function luminance(hex: string) {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((at) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** White or black, whichever contrasts more with the colour: never below 4.58:1. */
export const inkOn = (color: string) => (contrast(color, "#ffffff") >= contrast(color, "#000000") ? "#ffffff" : "#000000");
