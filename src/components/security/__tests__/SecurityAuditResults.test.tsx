import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { SecurityAuditResults, getSeverityColor } from "../SecurityAuditResults";

const renderResults = (props: Partial<React.ComponentProps<typeof SecurityAuditResults>> = {}) =>
  render(
    <FluentProvider theme={webLightTheme}>
      <SecurityAuditResults
        loading={false}
        vulnerabilities={null}
        rawOutput={null}
        error={null}
        {...props}
      />
    </FluentProvider>,
  );

describe("SecurityAuditResults", () => {
  it("shows a spinner while loading", () => {
    renderResults({ loading: true });
    expect(screen.getByText("Running audit...")).toBeInTheDocument();
  });

  it("shows the error message", () => {
    renderResults({ error: "Audit failed: npm not found" });
    expect(screen.getByText("Audit failed: npm not found")).toBeInTheDocument();
  });

  it("shows a success message when there are no vulnerabilities", () => {
    renderResults({ vulnerabilities: [] });
    expect(screen.getByText(/No vulnerabilities found/)).toBeInTheDocument();
  });

  it("renders one card per vulnerability with its severity badge", () => {
    renderResults({
      vulnerabilities: [
        { title: "Prototype Pollution", severity: "critical", module_name: "lodash" },
        { title: "ReDoS", severity: "moderate", module_name: "minimatch" },
      ],
    });
    expect(screen.getByText("lodash")).toBeInTheDocument();
    expect(screen.getByText("CRITICAL")).toBeInTheDocument();
    expect(screen.getByText("minimatch")).toBeInTheDocument();
    expect(screen.getByText("MODERATE")).toBeInTheDocument();
  });

  it("falls back to a raw output block", () => {
    renderResults({ rawOutput: '{"something":"else"}' });
    expect(screen.getByText(/Raw Output/)).toBeInTheDocument();
    expect(screen.getByText('{"something":"else"}')).toBeInTheDocument();
  });
});

describe("getSeverityColor", () => {
  it("maps critical to danger", () => {
    expect(getSeverityColor("critical")).toBe("danger");
  });

  it("maps high to severe", () => {
    expect(getSeverityColor("high")).toBe("severe");
  });

  it("maps moderate to warning", () => {
    expect(getSeverityColor("moderate")).toBe("warning");
  });

  it("falls back to brand for anything else, case-insensitively", () => {
    expect(getSeverityColor("low")).toBe("brand");
    expect(getSeverityColor("CRITICAL")).toBe("danger");
  });
});
