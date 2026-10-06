"use client";

/**
 * Extrai o texto de um PDF no navegador, agrupado por linha visual e separado em colunas
 * (cada pedaço de texto do PDF vira uma célula). O arquivo não sai do computador.
 */
export async function pdfToRows(file: File): Promise<string[][]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const rows: string[][] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const { items } = await page.getTextContent();
    const lines: { y: number; cells: { x: number; s: string }[] }[] = [];

    for (const item of items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const x = item.transform[4] as number;
      const y = item.transform[5] as number;
      // Tolerância de 2 pt para pedaços da mesma linha com y ligeiramente diferente.
      let line = lines.find((l) => Math.abs(l.y - y) <= 2);
      if (!line) lines.push((line = { y, cells: [] }));
      line.cells.push({ x, s: item.str.trim() });
    }

    lines.sort((a, b) => b.y - a.y);
    for (const line of lines) rows.push(line.cells.sort((a, b) => a.x - b.x).map((c) => c.s));
    page.cleanup();
  }

  await pdf.destroy();
  return rows;
}
