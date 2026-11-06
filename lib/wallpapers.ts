/** Papéis de parede das conversas (o desenho de cada um fica no globals.css, em html[data-wall]). */
export const WALLPAPERS = ["vertices", "topografia", "pontos", "aurora"] as const;
export type Wallpaper = (typeof WALLPAPERS)[number];

export const WALLPAPER_LABEL: Record<Wallpaper, string> = {
  vertices: "Vértices",
  topografia: "Topografia",
  pontos: "Pontilhado",
  aurora: "Aurora",
};
