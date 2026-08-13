import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSecurityAudit } from "../useSecurityAudit";
import { commands } from "../../../bindings";

vi.mock("../../../bindings", () => ({
  commands: {
    runSecurityAudit: vi.fn(),
  },
}));

const runSecurityAudit = commands.runSecurityAudit as unknown as ReturnType<typeof vi.fn>;

describe("useSecurityAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses the npm7+/pnpm vulnerabilities shape", async () => {
    runSecurityAudit.mockResolvedValue({
      status: "ok",
      data: JSON.stringify({
        vulnerabilities: {
          lodash: {
            severity: "high",
            name: "lodash",
            via: [{ title: "Prototype Pollution", severity: "high" }],
          },
        },
      }),
    });

    const { result } = renderHook(() => useSecurityAudit("p1"));
    await act(async () => {
      await result.current.runAudit();
    });

    expect(result.current.vulnerabilities).toEqual([
      { title: "Prototype Pollution", severity: "high", module_name: "lodash" },
    ]);
    expect(result.current.error).toBeNull();
    expect(result.current.rawOutput).toBeNull();
  });

  it("parses the legacy npm advisories shape", async () => {
    runSecurityAudit.mockResolvedValue({
      status: "ok",
      data: JSON.stringify({
        advisories: {
          "123": { title: "ReDoS", severity: "moderate", module_name: "minimatch" },
        },
      }),
    });

    const { result } = renderHook(() => useSecurityAudit("p1"));
    await act(async () => {
      await result.current.runAudit();
    });

    expect(result.current.vulnerabilities).toEqual([
      { title: "ReDoS", severity: "moderate", module_name: "minimatch" },
    ]);
  });

  it("falls back to raw output for an unrecognized JSON shape", async () => {
    const raw = JSON.stringify({ something: "else" });
    runSecurityAudit.mockResolvedValue({ status: "ok", data: raw });

    const { result } = renderHook(() => useSecurityAudit("p1"));
    await act(async () => {
      await result.current.runAudit();
    });

    expect(result.current.vulnerabilities).toBeNull();
    expect(result.current.rawOutput).toBe(raw);
  });

  it("falls back to raw output for non-JSON data (e.g. Yarn's NDJSON audit format)", async () => {
    // yarn audit --json emits one JSON object per line, not one JSON
    // document - JSON.parse throws on the whole string, and this is the
    // real path every Yarn project's audit takes, not just malformed input.
    const ndjson = '{"type":"auditAdvisory","data":{}}\n{"type":"auditSummary","data":{}}';
    runSecurityAudit.mockResolvedValue({ status: "ok", data: ndjson });

    const { result } = renderHook(() => useSecurityAudit("p1"));
    await act(async () => {
      await result.current.runAudit();
    });

    expect(result.current.vulnerabilities).toBeNull();
    expect(result.current.rawOutput).toBe(ndjson);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a command error without throwing", async () => {
    runSecurityAudit.mockResolvedValue({ status: "error", error: "npm not found" });

    const { result } = renderHook(() => useSecurityAudit("p1"));
    await act(async () => {
      await result.current.runAudit();
    });

    expect(result.current.error).toBe("Audit failed: npm not found");
    expect(result.current.vulnerabilities).toBeNull();
  });

  it("resets prior results at the start of a new run", async () => {
    runSecurityAudit.mockResolvedValueOnce({ status: "error", error: "boom" });
    const { result } = renderHook(() => useSecurityAudit("p1"));
    await act(async () => {
      await result.current.runAudit();
    });
    expect(result.current.error).toBe("Audit failed: boom");

    runSecurityAudit.mockResolvedValueOnce({
      status: "ok",
      data: JSON.stringify({ vulnerabilities: {} }),
    });
    await act(async () => {
      await result.current.runAudit();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.vulnerabilities).toEqual([]);
  });
});
