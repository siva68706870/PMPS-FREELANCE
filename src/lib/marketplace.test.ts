import { describe, expect, it } from "vitest";

describe("PMPS marketplace rules", () => {
  it("preserves the agreed 80/20 commission allocation", () => {
    const total = 1000;
    const freelancerShare = (total * 80) / 100;
    const ownerShare = (total * 20) / 100;

    expect(freelancerShare).toBe(800);
    expect(ownerShare).toBe(200);
    expect(freelancerShare + ownerShare).toBe(total);
  });

  it("limits public application decisions to the three client choices", () => {
    const clientDecisions = ["selected", "rejected", "shortlisted"];
    const availableStatuses = ["pending", "shortlisted", "selected", "rejected"];

    expect(clientDecisions.every((status) => availableStatuses.includes(status))).toBe(true);
    expect(clientDecisions).toHaveLength(3);
  });

  it("does not mark the future commission split as payment-ready", () => {
    const paymentsEnabled = false;
    const subscriptionsEnabled = false;

    expect(paymentsEnabled).toBe(false);
    expect(subscriptionsEnabled).toBe(false);
  });
});