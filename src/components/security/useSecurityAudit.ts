import { useState, useRef } from "react";
import { commands } from "../../bindings";

export interface Vulnerability {
  title: string;
  severity: string;
  module_name: string;
}

interface UseSecurityAuditResult {
  loading: boolean;
  vulnerabilities: Vulnerability[] | null;
  rawOutput: string | null;
  error: string | null;
  runAudit: () => Promise<void>;
}

export function useSecurityAudit(projectId: string | undefined): UseSecurityAuditResult {
  const [loading, setLoading] = useState(false);
  const [vulnerabilities, setVulnerabilities] = useState<Vulnerability[] | null>(null);
  const [rawOutput, setRawOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const auditInFlight = useRef(false);

  const parseAuditJson = (jsonStr: string) => {
    try {
      const data = JSON.parse(jsonStr);
      const vulns: Vulnerability[] = [];

      // npm (legacy) and older pnpm output format
      if (data.advisories) {
        Object.values(data.advisories).forEach((adv: any) => {
          vulns.push({
            title: adv.title || "Unknown",
            severity: adv.severity || "unknown",
            module_name: adv.module_name || "unknown",
          });
        });
      } else if (data.vulnerabilities) {
        Object.values(data.vulnerabilities).forEach((vuln: any) => {
          if (vuln.via && Array.isArray(vuln.via)) {
            vuln.via.forEach((v: any) => {
              if (typeof v === "object" && v.title) {
                vulns.push({
                  title: v.title,
                  severity: v.severity || vuln.severity || "unknown",
                  module_name: v.name || vuln.name || "unknown",
                });
              }
            });
          } else {
            vulns.push({
              title: vuln.name || "Unknown",
              severity: vuln.severity || "unknown",
              module_name: vuln.name || "unknown",
            });
          }
        });
      } else {
        setRawOutput(jsonStr);
        return;
      }

      setVulnerabilities(vulns);
    } catch {
      setRawOutput(jsonStr);
    }
  };

  const runAudit = async () => {
    if (!projectId || auditInFlight.current) return;
    
    auditInFlight.current = true;
    setLoading(true);
    setVulnerabilities(null);
    setRawOutput(null);
    setError(null);

    try {
      const result = await commands.runSecurityAudit(projectId);
      if (result.status === "ok") {
        parseAuditJson(result.data);
      } else {
        setError(`Audit failed: ${result.error}`);
      }
    } catch (err: any) {
      setError(`Unexpected error: ${err.message || err}`);
    } finally {
      auditInFlight.current = false;
      setLoading(false);
    }
  };

  return { loading, vulnerabilities, rawOutput, error, runAudit };
}
