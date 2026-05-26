// Brain: pdf-parse v2 espone la classe `PDFParse`, non una funzione default (v1 API).
// Passare un Buffer alla v1 API come funzione causa TypeError → 500 sul route /brain/upload.
export async function parsePdf(buffer: Buffer): Promise<string> {
  if (!buffer || buffer.byteLength === 0) {
    throw new Error("PDF parsing failed: buffer vuoto");
  }
  try {
    const { PDFParse } = await import("pdf-parse");
    const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const parser = new PDFParse({ data });
    const result = await parser.getText();
    return (result.text ?? "").trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    throw new Error(`PDF parsing failed: ${msg}`);
  }
}
