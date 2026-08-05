import { describe, expect, it } from "vitest";
import { mapProviderStatusToInternal } from "./status-mapping";

describe("mapProviderStatusToInternal", () => {
  it("approved -> approved", () => {
    expect(mapProviderStatusToInternal("approved", null)).toBe("approved");
  });

  it("rejected -> rejected", () => {
    expect(mapProviderStatusToInternal("rejected", "cc_rejected_insufficient_amount")).toBe("rejected");
  });

  it("cancelled sem detail -> cancelled", () => {
    expect(mapProviderStatusToInternal("cancelled", "by_collector")).toBe("cancelled");
  });

  it("cancelled com detail de expiração -> expired", () => {
    expect(mapProviderStatusToInternal("cancelled", "expired")).toBe("expired");
    expect(mapProviderStatusToInternal("cancelled", "payment_expired")).toBe("expired");
  });

  it("pending/in_process/authorized/in_mediation -> pending", () => {
    expect(mapProviderStatusToInternal("pending", null)).toBe("pending");
    expect(mapProviderStatusToInternal("in_process", null)).toBe("pending");
    expect(mapProviderStatusToInternal("authorized", null)).toBe("pending");
    expect(mapProviderStatusToInternal("in_mediation", null)).toBe("pending");
  });

  it("status desconhecido nunca decide um estado terminal sozinho", () => {
    expect(mapProviderStatusToInternal("refunded", null)).toBe("pending");
    expect(mapProviderStatusToInternal("charged_back", null)).toBe("pending");
    expect(mapProviderStatusToInternal("something_new", null)).toBe("pending");
  });
});
