import type { SourceType } from "../types.js";
import { parseTxt } from "./txt.parser.js";
import { parseMd } from "./md.parser.js";
import { parsePdf } from "./pdf.parser.js";
import { parseDocx } from "./docx.parser.js";

export async function parseDocument(
  buffer: Buffer,
  sourceType: SourceType,
): Promise<string> {
  switch (sourceType) {
    case "txt":
      return parseTxt(buffer);
    case "md":
      return parseMd(buffer);
    case "pdf":
      return parsePdf(buffer);
    case "docx":
      return parseDocx(buffer);
    case "agent_memory":
      return buffer.toString("utf-8").trim();
    default:
      throw new Error(`Unsupported source type: ${sourceType}`);
  }
}

export { chunkText, type TextChunk } from "./chunker.js";
