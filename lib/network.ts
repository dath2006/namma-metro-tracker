export type Station = { code: string; name: string; kn: string | null; at: number; stop: number; lon: number; lat: number; xfer: string[] };
export type Line = {
  id: string;
  name: string;
  color: string;
  open: boolean;
  ends: [string, string];
  length: number;
  path: [number, number][];
  cum?: number[]; // chainage of each path vertex; set when the path has been hand-corrected (see overrides.ts)
  stations: Station[];
  tunnels: [number, number][]; // underground chainage ranges (m); trains inside are not drawn
};
export type Network = { lines: Line[]; schedule: Record<string, unknown> };
