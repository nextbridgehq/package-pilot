# Security Policy

## Supported Versions

Currently, only the latest release of Package Pilot is supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take the security of Package Pilot seriously. If you discover a security vulnerability, please do NOT report it by opening a public GitHub issue.

Instead, please send an email to the repository maintainers or use GitHub's private vulnerability reporting feature.

### What to Include in Your Report
To help us investigate the issue quickly, please provide the following information:
- A detailed description of the vulnerability.
- Steps to reproduce the issue (including any sample packages or scripts).
- Your operating system and Node.js version.
- Potential impact and any ideas you have for a fix.

We will acknowledge receipt of your vulnerability report as soon as possible and strive to send you regular updates about our progress.

## Sandboxing Notice
Package Pilot provides a local testing sandbox for Node.js packages (npm, pnpm, and yarn). While it restricts certain filesystem and network features, it relies on local execution. Do not run completely untrusted or heavily obfuscated malware using Package Pilot on your host machine without a VM or containerized environment if maximum isolation is required.

---

[← Back to README](README.md)
