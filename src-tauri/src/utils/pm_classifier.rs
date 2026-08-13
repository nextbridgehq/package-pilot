use crate::models::project::PackageManager;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub enum FindingKind {
    PeerDependencyConflict,
    EngineUnavailable,
    ExecutionFailure,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
pub struct StructuredFinding {
    pub source_engine: PackageManager,
    pub kind: FindingKind,
    pub title: String,
    pub details: String,
    pub recommendation: Option<String>,
}

pub fn classify_execution_failure(
    engine: PackageManager,
    stderr: &str,
    stdout: &str,
) -> Vec<StructuredFinding> {
    let mut findings = Vec::new();
    let combined = format!("{}\n{}", stdout, stderr);
    let lower = combined.to_lowercase();

    if lower.contains("eresolve")
        || lower.contains("could not resolve peer dependency")
        || lower.contains("err_pnpm_peer_dep_issues")
        || lower.contains("unmet peer dependencies")
    {
        findings.push(StructuredFinding {
            source_engine: engine,
            kind: FindingKind::PeerDependencyConflict,
            title: "Peer Dependency Conflict Detected".to_string(),
            details: combined.trim().to_string(),
            recommendation: Some(
                "Verify that peer dependency version requirements match the target project's installed versions.".to_string(),
            ),
        });
    }

    if findings.is_empty() {
        findings.push(StructuredFinding {
            source_engine: engine,
            kind: FindingKind::ExecutionFailure,
            title: format!("Command execution failed using {:?}", engine),
            details: stderr.trim().to_string(),
            recommendation: None,
        });
    }

    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_npm_eresolve() {
        let stderr = "npm ERR! code ERESOLVE\nnpm ERR! ERESOLVE could not resolve peer dependency\nnpm ERR! peer react@\"^18.0.0\" from react-dom@18.2.0";
        let findings = classify_execution_failure(PackageManager::Npm, stderr, "");
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].kind, FindingKind::PeerDependencyConflict);
        assert_eq!(findings[0].source_engine, PackageManager::Npm);
        assert!(findings[0].title.contains("Peer Dependency Conflict"));
    }

    #[test]
    fn test_classify_pnpm_peer_issue() {
        let stdout = "ERR_PNPM_PEER_DEP_ISSUES Unmet peer dependencies:\nreact@\"^18.0.0\" is in the peerDependencies of react-dom";
        let findings = classify_execution_failure(PackageManager::Pnpm, "", stdout);
        assert_eq!(findings[0].kind, FindingKind::PeerDependencyConflict);
        assert_eq!(findings[0].source_engine, PackageManager::Pnpm);
    }

    #[test]
    fn test_classify_generic_execution_failure() {
        let stderr = "Command failed with exit code 1";
        let findings = classify_execution_failure(PackageManager::Yarn, stderr, "");
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].kind, FindingKind::ExecutionFailure);
        assert_eq!(findings[0].source_engine, PackageManager::Yarn);
        assert_eq!(findings[0].title, "Command execution failed using Yarn");
        assert_eq!(findings[0].details, "Command failed with exit code 1");
        assert_eq!(findings[0].recommendation, None);
    }
}
