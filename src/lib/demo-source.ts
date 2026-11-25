const HINTS: Array<[RegExp, string]> = [
  [/esplay/i, "esplay"],
  [/faceit/i, "faceit"],
  [/5eplay|5e_/i, "5eplay"],
  [/match730|\bvalve\b/i, "valve"],
  [/popflash/i, "popflash"],
  [/esea/i, "esea"],
  [/esportal/i, "esportal"],
  [/fastcup/i, "fastcup"],
  [/renown/i, "renown"],
  [/matchzy/i, "matchzy"],
  [/gamersclub/i, "gamersclub"],
  [/perfectworld|完美世界/i, "perfectworld"],
  [/challengermode/i, "challengermode"],
  [/ebot/i, "ebot"],
  [/pracc/i, "pracc"],
  [/\besl\b/i, "esl"],
];

// The analyzer often cannot see Esplay, 5EPlay, or FACEIT from the demo header.
// Their own tests pass -source explicitly. A hint in the filename is enough for one retry.
export function sourceHint(filename: string): string | null {
  for (const [pattern, source] of HINTS) {
    if (pattern.test(filename)) return source;
  }
  return null;
}
