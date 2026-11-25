import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { frequentPlayersFor, rankFrequentPlayers } from "@/lib/frequent-players";
import type { MatchInput } from "@/lib/match";
import { listDemos, createDemo, deleteDemo, writeAnalysis } from "@/lib/store";

async function entries() {
  return (await listDemos()).map((demo) => ({ id: demo.id, assetId: demo.id, createdAt: demo.createdAt, bindingState: "pending" as const, steamId: null }));
}

const player = (n: number, name = `选手 ${n}`) => ({ steamId: `7656119800000000${n}`, name });
const match = (checksum: string, day: number, players = [player(1)]): MatchInput => ({
  checksum, date: `2026-11-${String(day).padStart(2, "0")}`, players,
});

describe("frequent players", () => {
  const dataDirBefore = process.env.DATA_DIR;
  afterEach(() => {
    if (dataDirBefore === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = dataDirBefore;
  });

  it("counts three distinct retained matches across duplicate uploads and name changes", async () => {
    process.env.DATA_DIR = await mkdtemp(path.join(tmpdir(), "chaipian-roster-"));
    const first = await createDemo("first.dem", Buffer.from("first"));
    const duplicate = await createDemo("duplicate.dem", Buffer.from("first"));
    const second = await createDemo("second.dem", Buffer.from("second"));
    const firstMatch = match("one", 1);
    await writeAnalysis(first.id, firstMatch, []);
    await writeAnalysis(duplicate.id, firstMatch, []);
    await writeAnalysis(second.id, match("two", 2, [player(1, "改名")]), []);
    expect(await frequentPlayersFor(first.id, firstMatch, await entries())).toEqual([]);

    const third = await createDemo("third.dem", Buffer.from("third"));
    await writeAnalysis(third.id, match("three", 3), []);
    await writeAnalysis(first.id, match("one", 1, [player(1, "重新分析")]), []);
    expect(await frequentPlayersFor(first.id, firstMatch, await entries())).toEqual([{ steamId: player(1).steamId, appearances: 3 }]);
    await deleteDemo(third.id);
    expect(await frequentPlayersFor(first.id, firstMatch, await entries())).toEqual([]);
  });

  it("returns only current players and sorts ties by most recent match before capping at three", () => {
    const lineup = [player(1), player(2), player(3), player(4), player(5)];
    const matches = [
      match("a", 1, lineup), match("b", 2, lineup), match("c", 3, lineup),
      match("d", 4, [player(2), player(5)]), match("e", 5, [player(3)]),
    ];
    const library = matches.map((item) => ({ match: item, createdAt: item.date! }));
    expect(rankFrequentPlayers(match("x", 6, lineup.slice(0, 4)), library)).toEqual([
      { steamId: player(3).steamId, appearances: 4 },
      { steamId: player(2).steamId, appearances: 4 },
      { steamId: player(1).steamId, appearances: 3 },
    ]);
  });
});
