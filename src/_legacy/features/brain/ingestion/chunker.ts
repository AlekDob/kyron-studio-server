// Brain: 004-brain-module — chunking strategy: fixed-size con overlap

export interface TextChunk {
  index: number;
  content: string;
}

const DEFAULT_CHUNK_SIZE = 512;
const DEFAULT_OVERLAP = 64;

export function chunkText(
  text: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_OVERLAP,
): TextChunk[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    const content = words.slice(start, end).join(" ");
    chunks.push({ index, content });
    index++;
    start += chunkSize - overlap;
    if (start >= words.length) break;
  }

  return chunks;
}
