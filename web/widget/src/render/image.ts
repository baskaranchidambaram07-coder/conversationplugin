// A drawn chart or diagram as a picture to save (M3-T6, T7). The SVG is copied with each part's paint, as the page's
// styles computed it, written onto the part, so it draws the same outside the page; then it is painted at twice its
// size onto a canvas with its title and legend, and saved as PNG. Nothing is fetched and nothing leaves the chat.

const PAINT = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-opacity",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "visibility",
  "display",
];

/** The SVG's markup with its computed paint written onto every part, at its own drawn size. */
export function standalone(svg: SVGSVGElement, width: number, height: number): string {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const live = [svg, ...svg.querySelectorAll("*")];
  const copied = [copy, ...copy.querySelectorAll("*")];
  live.forEach((part, i) => {
    const style = getComputedStyle(part);
    for (const name of PAINT) {
      const value = style.getPropertyValue(name);
      if (value) copied[i]!.setAttribute(name, value);
    }
    copied[i]!.removeAttribute("class");
  });
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(width));
  copy.setAttribute("height", String(height));
  return new XMLSerializer().serializeToString(copy);
}

const SCALE = 2;
const PAD = 16;

export type Picture = { svg: SVGSVGElement; width: number; height: number; ground: string; title?: string; legend?: { name: string; colour: string }[] };

/** The picture as PNG: the ground, then the title and legend (in the chat's own font), then the drawing. */
export async function pngOf({ svg, width, height, ground, title = "", legend = [] }: Picture): Promise<Blob> {
  const font = getComputedStyle(document.body).fontFamily;
  const ink = getComputedStyle(svg.closest("figure") ?? document.body).color;
  const above = (title ? 26 : 0) + (legend.length ? 24 : 0);
  const canvas = document.createElement("canvas");
  canvas.width = (width + 2 * PAD) * SCALE;
  canvas.height = (height + 2 * PAD + above) * SCALE;
  const paint = canvas.getContext("2d")!;
  paint.scale(SCALE, SCALE);
  paint.fillStyle = ground;
  paint.fillRect(0, 0, width + 2 * PAD, height + 2 * PAD + above);
  paint.fillStyle = ink;
  paint.textBaseline = "middle";
  if (title) {
    paint.font = `600 15px ${font}`;
    paint.fillText(title, PAD, PAD + 9, width);
  }
  let x = PAD;
  paint.font = `13px ${font}`;
  for (const { name, colour } of legend) {
    const y = PAD + (title ? 26 : 0) + 8;
    paint.fillStyle = colour;
    paint.fillRect(x, y - 5, 10, 10);
    paint.fillStyle = ink;
    paint.fillText(name, x + 16, y);
    x += 16 + paint.measureText(name).width + 16;
  }
  const address = URL.createObjectURL(new Blob([standalone(svg, width, height)], { type: "image/svg+xml" }));
  try {
    const drawing = new Image();
    drawing.src = address;
    await drawing.decode();
    paint.drawImage(drawing, PAD, PAD + above, width, height);
  } finally {
    URL.revokeObjectURL(address);
  }
  return new Promise((done, fail) => canvas.toBlob((png) => (png ? done(png) : fail(new Error("no picture"))), "image/png"));
}

/** A file name from a title: "Rent by month" becomes rent-by-month.png. */
export const pictureName = (title: string, fallback: string) =>
  `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || fallback}.png`;
