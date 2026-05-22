export interface AdjacencyFile {
  generated_at: string;
  count: number;
  adjacency: Record<string, string[]>;
}

let cached: Record<string, string[]> | null = null;

export async function loadAdjacency(): Promise<Record<string, string[]>> {
  if (cached) return cached;
  const resp = await fetch("/province-adjacency.json");
  if (!resp.ok) throw new Error(`failed to load province-adjacency.json: ${resp.status}`);
  const file = (await resp.json()) as AdjacencyFile;
  cached = file.adjacency;
  return cached;
}
