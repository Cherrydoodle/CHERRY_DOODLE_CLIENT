import { describe, expect, it } from "vitest";

import { advanceOrderTo, targetOrderStatusForScan } from "@/features/delhivery/status-map";

describe("advanceOrderTo", () => {
  it("walks every intermediate hop from pending to delivered", () => {
    expect(advanceOrderTo("pending", "delivered")).toEqual(["processing", "shipped", "delivered"]);
  });

  it("returns a single hop when already adjacent", () => {
    expect(advanceOrderTo("pending", "processing")).toEqual(["processing"]);
    expect(advanceOrderTo("processing", "shipped")).toEqual(["shipped"]);
    expect(advanceOrderTo("shipped", "delivered")).toEqual(["delivered"]);
  });

  it("skips a hop correctly (processing -> delivered)", () => {
    expect(advanceOrderTo("processing", "delivered")).toEqual(["shipped", "delivered"]);
  });

  it("returns null when the target is not forward progress", () => {
    expect(advanceOrderTo("shipped", "processing")).toBeNull();
    expect(advanceOrderTo("delivered", "delivered")).toBeNull();
    expect(advanceOrderTo("processing", "processing")).toBeNull();
  });

  it("returns null for a cancelled order regardless of target", () => {
    expect(advanceOrderTo("cancelled", "delivered")).toBeNull();
  });
});

describe("targetOrderStatusForScan", () => {
  it("maps DL to delivered", () => {
    expect(targetOrderStatusForScan({ statusType: "DL", status: "Delivered", nslCode: null, pickUpDate: "2026-01-01" })).toBe("delivered");
  });

  it("maps UD without a pickup date to processing (not yet picked up)", () => {
    expect(targetOrderStatusForScan({ statusType: "UD", status: "Manifested", nslCode: null, pickUpDate: null })).toBe("processing");
  });

  it("maps UD with a pickup date to shipped (in transit)", () => {
    expect(targetOrderStatusForScan({ statusType: "UD", status: "In Transit", nslCode: null, pickUpDate: "2026-01-02" })).toBe("shipped");
  });

  it("maps RT (return to origin) to shipped, not an automatic cancel", () => {
    expect(targetOrderStatusForScan({ statusType: "RT", status: "RTO Initiated", nslCode: "X-RTO", pickUpDate: "2026-01-02" })).toBe("shipped");
  });

  it("returns null for lost/cancelled scans and unrecognized codes", () => {
    expect(targetOrderStatusForScan({ statusType: "LT", status: "Lost", nslCode: null, pickUpDate: null })).toBeNull();
    expect(targetOrderStatusForScan({ statusType: "CN", status: "Cancelled", nslCode: null, pickUpDate: null })).toBeNull();
    expect(targetOrderStatusForScan({ statusType: "XX", status: "Unknown", nslCode: null, pickUpDate: null })).toBeNull();
    expect(targetOrderStatusForScan({ statusType: null, status: null, nslCode: null, pickUpDate: null })).toBeNull();
  });
});
