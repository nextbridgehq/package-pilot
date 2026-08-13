use crate::models::project::{InstallOptions, OperationSupport, PackageManager, PmCommand};

pub trait PackageManagerEngine: Send + Sync {
    fn kind(&self) -> PackageManager;
    fn name(&self) -> &'static str;
    fn install_cmd(&self, opts: &InstallOptions) -> PmCommand;
    fn run_script_cmd(&self, script_name: &str, extra_args: &[String]) -> PmCommand;
    fn pack_cmd(&self) -> OperationSupport<PmCommand>;
}

pub struct NpmEngine;

impl PackageManagerEngine for NpmEngine {
    fn kind(&self) -> PackageManager {
        PackageManager::Npm
    }

    fn name(&self) -> &'static str {
        "npm"
    }

    fn install_cmd(&self, opts: &InstallOptions) -> PmCommand {
        let mut args = vec!["install".to_string()];
        if let Some(ref target) = opts.target_tarball {
            args.push(target.clone());
        }
        if opts.no_save {
            args.push("--no-save".to_string());
        }
        if opts.ignore_scripts {
            args.push("--ignore-scripts".to_string());
        }
        PmCommand {
            program: "npm".to_string(),
            args,
        }
    }

    fn run_script_cmd(&self, script_name: &str, extra_args: &[String]) -> PmCommand {
        let mut args = vec!["run".to_string(), script_name.to_string()];
        if !extra_args.is_empty() {
            args.push("--".to_string());
            args.extend(extra_args.iter().cloned());
        }
        PmCommand {
            program: "npm".to_string(),
            args,
        }
    }

    fn pack_cmd(&self) -> OperationSupport<PmCommand> {
        OperationSupport::Native(PmCommand {
            program: "npm".to_string(),
            args: vec!["pack".to_string()],
        })
    }
}

pub struct PnpmEngine;

impl PackageManagerEngine for PnpmEngine {
    fn kind(&self) -> PackageManager {
        PackageManager::Pnpm
    }

    fn name(&self) -> &'static str {
        "pnpm"
    }

    fn install_cmd(&self, opts: &InstallOptions) -> PmCommand {
        let mut args = if let Some(ref target) = opts.target_tarball {
            vec!["add".to_string(), target.clone()]
        } else {
            vec!["install".to_string()]
        };
        if opts.no_save && opts.target_tarball.is_some() {
            args.push("--save-prod=false".to_string());
        }
        if opts.ignore_scripts {
            args.push("--ignore-scripts".to_string());
        }
        PmCommand {
            program: "pnpm".to_string(),
            args,
        }
    }

    fn run_script_cmd(&self, script_name: &str, extra_args: &[String]) -> PmCommand {
        let mut args = vec!["run".to_string(), script_name.to_string()];
        args.extend(extra_args.iter().cloned());
        PmCommand {
            program: "pnpm".to_string(),
            args,
        }
    }

    fn pack_cmd(&self) -> OperationSupport<PmCommand> {
        OperationSupport::Native(PmCommand {
            program: "pnpm".to_string(),
            args: vec!["pack".to_string()],
        })
    }
}

pub struct YarnEngine;

impl PackageManagerEngine for YarnEngine {
    fn kind(&self) -> PackageManager {
        PackageManager::Yarn
    }

    fn name(&self) -> &'static str {
        "yarn"
    }

    fn install_cmd(&self, opts: &InstallOptions) -> PmCommand {
        let mut args = if let Some(ref target) = opts.target_tarball {
            vec!["add".to_string(), target.clone()]
        } else {
            vec!["install".to_string()]
        };
        if opts.ignore_scripts {
            args.push("--ignore-scripts".to_string());
        }
        PmCommand {
            program: "yarn".to_string(),
            args,
        }
    }

    fn run_script_cmd(&self, script_name: &str, extra_args: &[String]) -> PmCommand {
        let mut args = vec![script_name.to_string()];
        args.extend(extra_args.iter().cloned());
        PmCommand {
            program: "yarn".to_string(),
            args,
        }
    }

    fn pack_cmd(&self) -> OperationSupport<PmCommand> {
        OperationSupport::Native(PmCommand {
            program: "yarn".to_string(),
            args: vec!["pack".to_string()],
        })
    }
}

pub struct BunEngine;

impl PackageManagerEngine for BunEngine {
    fn kind(&self) -> PackageManager {
        PackageManager::Bun
    }

    fn name(&self) -> &'static str {
        "bun"
    }

    fn install_cmd(&self, opts: &InstallOptions) -> PmCommand {
        let mut args = if let Some(ref target) = opts.target_tarball {
            vec!["add".to_string(), target.clone()]
        } else {
            vec!["install".to_string()]
        };
        if opts.ignore_scripts {
            args.push("--ignore-scripts".to_string());
        }
        PmCommand {
            program: "bun".to_string(),
            args,
        }
    }

    fn run_script_cmd(&self, script_name: &str, extra_args: &[String]) -> PmCommand {
        let mut args = vec!["run".to_string(), script_name.to_string()];
        args.extend(extra_args.iter().cloned());
        PmCommand {
            program: "bun".to_string(),
            args,
        }
    }

    fn pack_cmd(&self) -> OperationSupport<PmCommand> {
        OperationSupport::Fallback {
            run: PmCommand {
                program: "npm".to_string(),
                args: vec!["pack".to_string()],
            },
            note: "Bun native packaging (bun pm pack) is currently unverified for release fidelity; falling back to npm pack.".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_npm_engine_kind_and_name() {
        let engine = NpmEngine;
        assert_eq!(engine.kind(), PackageManager::Npm);
        assert_eq!(engine.name(), "npm");
    }

    #[test]
    fn test_npm_engine_install_no_legacy_peer_deps() {
        let engine = NpmEngine;
        let opts = InstallOptions {
            target_tarball: Some("lib.tgz".to_string()),
            ignore_scripts: true,
            no_save: true,
        };
        let cmd = engine.install_cmd(&opts);
        assert_eq!(cmd.program, "npm");
        assert!(!cmd.args.contains(&"--legacy-peer-deps".to_string()));
        assert_eq!(
            cmd.args,
            vec!["install", "lib.tgz", "--no-save", "--ignore-scripts"]
        );
    }

    #[test]
    fn test_npm_engine_install_default() {
        let engine = NpmEngine;
        let opts = InstallOptions {
            target_tarball: None,
            ignore_scripts: false,
            no_save: false,
        };
        let cmd = engine.install_cmd(&opts);
        assert_eq!(cmd.program, "npm");
        assert_eq!(cmd.args, vec!["install"]);
    }

    #[test]
    fn test_npm_engine_run_script() {
        let engine = NpmEngine;
        let cmd = engine.run_script_cmd("test", &["--coverage".to_string()]);
        assert_eq!(cmd.program, "npm");
        assert_eq!(cmd.args, vec!["run", "test", "--", "--coverage"]);

        let cmd_no_args = engine.run_script_cmd("build", &[]);
        assert_eq!(cmd_no_args.args, vec!["run", "build"]);
    }

    #[test]
    fn test_npm_engine_pack() {
        let engine = NpmEngine;
        let pack = engine.pack_cmd();
        assert_eq!(
            pack,
            OperationSupport::Native(PmCommand {
                program: "npm".to_string(),
                args: vec!["pack".to_string()]
            })
        );
    }

    #[test]
    fn test_pnpm_engine_kind_and_name() {
        let engine = PnpmEngine;
        assert_eq!(engine.kind(), PackageManager::Pnpm);
        assert_eq!(engine.name(), "pnpm");
    }

    #[test]
    fn test_pnpm_engine_install_and_pack() {
        let engine = PnpmEngine;
        let opts = InstallOptions {
            target_tarball: Some("pkg.tgz".to_string()),
            ignore_scripts: true,
            no_save: true,
        };
        let cmd = engine.install_cmd(&opts);
        assert_eq!(cmd.program, "pnpm");
        assert_eq!(
            cmd.args,
            vec!["add", "pkg.tgz", "--save-prod=false", "--ignore-scripts"]
        );

        let default_opts = InstallOptions {
            target_tarball: None,
            ignore_scripts: false,
            no_save: false,
        };
        let default_cmd = engine.install_cmd(&default_opts);
        assert_eq!(default_cmd.args, vec!["install"]);

        let pack = engine.pack_cmd();
        assert_eq!(
            pack,
            OperationSupport::Native(PmCommand {
                program: "pnpm".to_string(),
                args: vec!["pack".to_string()]
            })
        );
    }

    #[test]
    fn test_pnpm_engine_run_script() {
        let engine = PnpmEngine;
        let cmd = engine.run_script_cmd("build", &["--filter".to_string(), "app".to_string()]);
        assert_eq!(cmd.program, "pnpm");
        assert_eq!(cmd.args, vec!["run", "build", "--filter", "app"]);
    }

    #[test]
    fn test_yarn_engine_kind_and_name() {
        let engine = YarnEngine;
        assert_eq!(engine.kind(), PackageManager::Yarn);
        assert_eq!(engine.name(), "yarn");
    }

    #[test]
    fn test_yarn_engine_install_and_pack() {
        let engine = YarnEngine;
        let opts = InstallOptions {
            target_tarball: Some("lib.tgz".to_string()),
            ignore_scripts: true,
            no_save: false,
        };
        let cmd = engine.install_cmd(&opts);
        assert_eq!(cmd.program, "yarn");
        assert_eq!(cmd.args, vec!["add", "lib.tgz", "--ignore-scripts"]);

        let default_opts = InstallOptions {
            target_tarball: None,
            ignore_scripts: false,
            no_save: false,
        };
        let default_cmd = engine.install_cmd(&default_opts);
        assert_eq!(default_cmd.args, vec!["install"]);

        let pack = engine.pack_cmd();
        assert_eq!(
            pack,
            OperationSupport::Native(PmCommand {
                program: "yarn".to_string(),
                args: vec!["pack".to_string()]
            })
        );
    }

    #[test]
    fn test_yarn_engine_run_script() {
        let engine = YarnEngine;
        let cmd = engine.run_script_cmd("start", &["--port".to_string(), "3000".to_string()]);
        assert_eq!(cmd.program, "yarn");
        assert_eq!(cmd.args, vec!["start", "--port", "3000"]);
    }

    #[test]
    fn test_bun_engine_kind_and_name() {
        let engine = BunEngine;
        assert_eq!(engine.kind(), PackageManager::Bun);
        assert_eq!(engine.name(), "bun");
    }

    #[test]
    fn test_bun_engine_install_and_run() {
        let engine = BunEngine;
        let opts = InstallOptions {
            target_tarball: Some("lib.tgz".to_string()),
            ignore_scripts: true,
            no_save: false,
        };
        let cmd = engine.install_cmd(&opts);
        assert_eq!(cmd.program, "bun");
        assert_eq!(cmd.args, vec!["add", "lib.tgz", "--ignore-scripts"]);

        let default_opts = InstallOptions {
            target_tarball: None,
            ignore_scripts: false,
            no_save: false,
        };
        let default_cmd = engine.install_cmd(&default_opts);
        assert_eq!(default_cmd.args, vec!["install"]);

        let run_cmd = engine.run_script_cmd("dev", &["--port".to_string(), "8080".to_string()]);
        assert_eq!(run_cmd.program, "bun");
        assert_eq!(run_cmd.args, vec!["run", "dev", "--port", "8080"]);
    }

    #[test]
    fn test_bun_engine_pack_fallback() {
        let engine = BunEngine;
        let pack = engine.pack_cmd();
        match pack {
            OperationSupport::Fallback { run, note } => {
                assert_eq!(run.program, "npm");
                assert_eq!(run.args, vec!["pack"]);
                assert!(note.contains("unverified"));
            }
            _ => panic!("Expected Fallback support for Bun pack"),
        }
    }
}
