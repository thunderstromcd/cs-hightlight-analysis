import { describe, expect, it } from "vitest";
import { sourceHint } from "@/lib/demo-source";

describe("sourceHint", () => {
  it("reads the platform out of a demo filename", () => {
    expect(sourceHint("esplay_nnQccdWWJtkc_2025_vertigo.dem")).toBe("esplay");
    expect(sourceHint("5eplay_g161_mirage.dem")).toBe("5eplay");
    expect(sourceHint("faceit_2d199377-f179.dem")).toBe("faceit");
    expect(sourceHint("match730_003598554255364980910_ancient.dem")).toBe("valve");
    expect(sourceHint("我的比赛.dem")).toBeNull();
  });
});
