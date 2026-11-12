# GitHub settings that cannot live in the repository

Do these once, as the repository owner (Settings on github.com). They turn the CI from advice into a rule.

## Branch protection for `main`

Settings, Branches, Add branch protection rule, pattern `main`:

* **Require a pull request before merging** (at least 1 approval; "Dismiss stale approvals" on).
* **Require status checks to pass before merging**, and "Require branches to be up to date". Select these checks (they appear after the first run):
  * `Backend CI`, `Frontend CI` (workflow "CI/CD Pipeline")
  * `Verification scripts (unit tests, no Docker)` and `Docker stack with Kafka (build, start, verify, drills)` (workflow "Docker and Kafka verification")
  * `Dependencies (npm audit gate)`, `Secrets (gitleaks, full history)`, `Dockerfiles (hadolint)` (workflow "Security")
* **Require conversation resolution before merging.**
* **Do not allow force pushes** and **do not allow deletions.**
* Optional: **Require signed commits**, **Require linear history**.

## Security features

Settings, Code security:

* **Dependency graph**, **Dependabot alerts** and **Dependabot security updates**: on (the schedule for version updates is in `.github/dependabot.yml`).
* **Secret scanning** and **push protection**: on (free for public repositories; GitHub Advanced Security for private ones).
* **Code scanning** (CodeQL): the "Security" workflow runs it on public repositories only; on a private repository it needs Advanced Security.

## Actions

Settings, Actions, General:

* "Workflow permissions": **Read repository contents** (every workflow here declares its own minimal permissions).
* "Fork pull request workflows": require approval for first-time contributors.

## The leaked database password

The first gitleaks run will report a database URL that was committed in `DEPLOYMENT_CHECKLIST.md` and `DEPLOYMENT_VERIFICATION.md` (now in
`docs/archive/`). It is still in the git history. **Rotate that password** (PRODUCTION_CHECKLIST section 4), then record the finding's fingerprint
from the gitleaks output in a `.gitleaksignore` file so the scan is green again. Do not rewrite the history of `main` for this.
