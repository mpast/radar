import test from "node:test";
import assert from "node:assert/strict";
import { compareRegistrationNewest } from "../public/car-registration.js";

test("registration sort uses full dates, falls back to year and puts unknown values last", () => {
  const cars = [
    { id: "unknown", kind: "cars", firstSeen: "2026-11-06" },
    { id: "older", kind: "cars", year: 2024, firstSeen: "2026-11-06" },
    { id: "april", kind: "cars", year: 2025, registrationDate: "2025-04-08" },
    { id: "year-only", kind: "cars", year: 2025 },
    {
      id: "october",
      kind: "cars",
      year: 2025,
      registrationDate: "2025-10-01",
      firstSeen: "2026-01-01",
    },
    { id: "newest", kind: "cars", year: 2026 },
  ];
  assert.deepEqual(
    cars.sort(compareRegistrationNewest).map((car) => car.id),
    ["newest", "october", "april", "year-only", "older", "unknown"],
  );
});

test("invalid dates fall back to year and homes never sort as registered cars", () => {
  const car = { kind: "cars", year: 2024, registrationDate: "2025-02-30" };
  assert(compareRegistrationNewest({ kind: "cars", year: 2025 }, car) < 0);
  assert(compareRegistrationNewest(car, { kind: "houses", year: 2026 }) < 0);
  assert.equal(
    compareRegistrationNewest(
      { kind: "cars", year: null },
      { kind: "cars", registrationDate: "invalid" },
    ),
    0,
  );
});

import { defaults, matches, validateSettings } from "../src/domain/core.mjs";
import { registrationYear } from "../public/car-registration.js";
import { matchesLocality } from "../public/locality.js";
import { effectiveSeats } from "../public/car-seats.js";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const eligibleCar = {
  kind: "cars",
  sellerType: "dealer",
  title: "Example",
  price: 15000,
  distance: 5,
  km: 10000,
};

test("minimum registration year includes its boundary and newer cars and ignores houses", () => {
  const settings = { ...defaults, minYear: 2024 };
  for (const [year, expected] of [
    [2023, false],
    [2024, true],
    [2025, true],
    [2026, true],
  ])
    assert.equal(matches({ ...eligibleCar, year }, settings), expected);
  assert(
    matches(
      { ...eligibleCar, year: 2023, registrationDate: "2024-01-01" },
      settings,
    ),
  );
  assert(
    !matches(
      { ...eligibleCar, year: 2025, registrationDate: "2023-12-31" },
      settings,
    ),
  );
  assert(
    matches(
      { ...eligibleCar, year: 2024, registrationDate: "invalid" },
      settings,
    ),
  );
  assert(
    matches(
      {
        kind: "houses",
        price: 100000,
        distance: 1,
        area: 100,
        beds: 3,
        year: 1990,
      },
      settings,
    ),
  );
  for (const year of [undefined, null, "invalid", 0, 2024.5]) {
    assert(!matches({ ...eligibleCar, year }, settings));
    assert(
      matches({ ...eligibleCar, year }, { ...settings, includeUnknown: true }),
    );
    assert(matches({ ...eligibleCar, year }, { ...settings, minYear: 0 }));
  }
});

test("minimum year validates, persists across other changes and clears to no minimum", () => {
  assert.equal(defaults.minYear, 0);
  const selected = validateSettings({ minYear: "2024" });
  assert.equal(selected.minYear, 2024);
  assert.equal(
    validateSettings({ model: "Aygo" }, JSON.parse(JSON.stringify(selected)))
      .minYear,
    2024,
  );
  for (const minYear of ["", 0, "0"])
    assert.equal(validateSettings({ minYear }, selected).minYear, 0);
  for (const minYear of [
    true,
    false,
    null,
    [],
    {},
    "2024.5",
    2024.5,
    1899,
    10000,
    -1,
    "2024 onwards",
    NaN,
    Infinity,
  ])
    assert.throws(() => validateSettings({ minYear }), /Año mínimo/);
});

test("browser and server agree on minimum registration year including favourites and sorting", () => {
  const source = readFileSync(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  );
  const allowed = source.match(/function allowed\(x\)\{[^\n]+/)[0];
  const context = vm.createContext({
    registrationYear,
    effectiveSeats,
    matchesLocality,
    state: { settings: { ...defaults, minYear: 2024 } },
  });
  vm.runInContext(allowed, context);
  const cars = [
    { ...eligibleCar, year: 2023 },
    { ...eligibleCar, year: 2024 },
    { ...eligibleCar, year: 2025, registrationDate: "2025-04-08" },
    { ...eligibleCar, year: null },
    { ...eligibleCar, year: 2026, registrationDate: "2023-12-31" },
  ].map((car) => ({ ...car, favourite: true }));
  for (const includeUnknown of [true, false]) {
    context.state.settings.includeUnknown = includeUnknown;
    for (const car of cars)
      assert.equal(context.allowed(car), matches(car, context.state.settings));
  }
  const filtered = cars
    .filter((car) => context.allowed(car))
    .sort(compareRegistrationNewest);
  assert.deepEqual(
    filtered.map((car) => registrationYear(car)),
    [2025, 2024],
  );
  context.state.settings.minYear = 0;
  assert(cars.every((car) => context.allowed(car)));
  const html = readFileSync(
    new URL("../public/index.html", import.meta.url),
    "utf8",
  );
  assert.match(
    html,
    /Año mínimo de matriculación<input name="minYear"[^>]+placeholder="Sin mínimo"/,
  );
});
