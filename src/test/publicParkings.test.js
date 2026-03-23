import { describe, expect, it } from "vitest";

import {
  isParkingOpenNow,
  isResidentOnlyParking,
} from "../utils/publicParkings";

describe("public parking helpers", () => {
  it("treats 7j / 7 parkings as open", () => {
    expect(
      isParkingOpenNow(
        { horaire_na: "7j / 7" },
        new Date("2026-03-23T10:00:00"),
      ),
    ).toBe(true);
  });

  it("keeps subscriber-only parkings filtered out", () => {
    expect(
      isResidentOnlyParking({
        type_usagers: "POUR ABONNES",
        horaire_na: "POUR ABONNES",
      }),
    ).toBe(true);
  });

  it("keeps explicit closed parkings filtered out", () => {
    expect(
      isParkingOpenNow(
        { horaire_na: "Fermé" },
        new Date("2026-03-23T10:00:00"),
      ),
    ).toBe(false);
  });
});
