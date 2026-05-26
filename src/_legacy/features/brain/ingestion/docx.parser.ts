export async function parseDocx(buffer: Buffer): Promise<string> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    throw new Error(`DOCX parsing failed: ${msg}`);
  }
}
