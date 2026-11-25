"use client";

import { ChevronDown, Search, UsersRound } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { FrequentPlayer } from "@/lib/frequent-players";
import type { PlayerSummary } from "@/lib/match";
import { cn } from "@/lib/utils";

type Team = { name: string; letter: string };

export function PlayerPicker({
  players, frequent = [], teams, selected, onSelect, identity, mySteamId,
}: {
  players: PlayerSummary[];
  frequent?: FrequentPlayer[];
  teams: [Team, Team];
  selected: string;
  onSelect: (id: string, makePreferred?: boolean) => void;
  identity?: { label: string; busy: boolean };
  mySteamId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [makePreferred, setMakePreferred] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const term = search.trim().toLocaleLowerCase();
  const matching = players.filter((player) => player.name.toLocaleLowerCase().includes(term));
  const active = players.find((player) => player.steamId === selected);
  const groupIndex = (player: PlayerSummary) => teams.findIndex(
    (team) => player.teamLetter ? team.letter === player.teamLetter : team.name === player.teamName,
  );
  const groups = [
    ...teams.map((team, index) => ({ ...team, tone: index === 0 ? "text-ct" : "text-t", players: matching.filter((player) => groupIndex(player) === index) })),
    { name: "其他选手", letter: "", tone: "text-muted-foreground", players: matching.filter((player) => groupIndex(player) < 0) },
  ];
  const shortcuts = frequent.flatMap(({ steamId, appearances }) => {
    const player = players.find((item) => item.steamId === steamId);
    return player ? [
      <Button key={steamId} type="button" size="sm" variant={selected === steamId ? "soft" : "ghost"}
        title={`${player.name}，${appearances} 场`} aria-pressed={selected === steamId}
        className="max-w-36 min-w-0" onClick={() => { onSelect(steamId); setOpen(false); }}
      >
        <span className="truncate">{player.name}</span>
      </Button>,
    ] : [];
  });

  return (
    <div className="player-toolbar" role="group" aria-label={identity ? "本场身份" : "选手筛选"}>
      {!identity && <Button type="button" size="sm" variant={selected === "all" ? "soft" : "ghost"} aria-pressed={selected === "all"} onClick={() => onSelect("all")}>
        全部选手
      </Button>}
      {mySteamId && <Button type="button" size="sm" variant={selected === mySteamId ? "soft" : "ghost"} aria-pressed={selected === mySteamId} onClick={() => onSelect(mySteamId)}>
        我的高光
      </Button>}
      <Button
        ref={trigger}
        type="button"
        size="sm"
        variant={identity ? "ghost" : active && selected !== mySteamId ? "soft" : "outline"}
        className="player-picker-trigger min-w-0"
        aria-label={identity?.label ?? (active ? `选择选手，当前 ${active.name}` : "选择选手")}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={identity?.busy}
        onClick={() => { setSearch(""); setMakePreferred(false); setOpen(true); }}
      >
        {!identity && <UsersRound className="shrink-0" size={16} aria-hidden />}
        <span className="truncate">{identity?.label ?? (selected !== mySteamId ? active?.name : undefined) ?? "选择选手"}</span>
        <ChevronDown className="shrink-0" size={14} aria-hidden />
      </Button>
      {shortcuts.length > 0 && (
        <div className="frequent-players" aria-label="常用选手">
          {shortcuts}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen} title={identity ? "选择你在本场的选手" : "选择选手"} returnFocus={trigger} initialFocus={searchField} description="按昵称搜索，或按战队浏览。"
        body={
          <>
            <div className="relative">
              <Search size={17} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
              <Input ref={searchField} className="pl-10" type="search" placeholder="搜索昵称" aria-label="搜索昵称" value={search}
                onChange={(event) => setSearch(event.target.value)} />
            </div>
            {shortcuts.length > 0 && <div className="picker-shortcuts mt-2">
              <p className="text-sm text-muted-foreground">常用选手</p>
              <div className="frequent-players">{shortcuts}</div>
            </div>}
            {identity && <label className="mt-3 flex min-h-9 items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={makePreferred} onChange={(event) => setMakePreferred(event.target.checked)} className="size-4 accent-accent" />
              设为常用，后续比赛优先显示这个选手
            </label>}
            <div className="mt-3">
              {groups.filter((group) => group.players.length > 0).map((group) => (
                <section key={group.letter} className="mt-3">
                  <div className="flex justify-between gap-3 py-2 text-sm">
                    <h3 className={cn("min-w-0 break-words font-semibold", group.tone)}>{group.name}</h3>
                    <span className="shrink-0 text-muted-foreground">K/D/A</span>
                  </div>
                  <ul>
                    {group.players.map((player) => (
                      <li key={player.steamId} className="border-t border-border">
                        <button type="button" className="picker-option" aria-pressed={selected === player.steamId}
                          onClick={() => { onSelect(player.steamId, makePreferred); setOpen(false); }}
                        >
                          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{player.name}</span>
                          <span className="shrink-0 text-sm text-muted-foreground">{player.kills}/{player.deaths}/{player.assists}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {matching.length === 0 && <p className="py-4 text-sm text-muted-foreground" role="status">没有匹配的昵称。</p>}
            </div>
          </>
        }
      />
    </div>
  );
}
