export type PrintOrientation = "portrait" | "landscape";

export function expectedOrientation(widthMm: number, heightMm: number): PrintOrientation {
  return widthMm > heightMm ? "landscape" : "portrait";
}
