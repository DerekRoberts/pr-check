# ☁️ Kilo Cloud

Automated analysis of failing Renovate/Dependabot PRs. Receives webhooks, analyzes failures via GitHub API, and emails actionable fix suggestions.

## How It Works

```
Renovate Monitor detects failing PR
           │
           ▼
  POST to Kilo Cloud webhook
           │
           ▼
GitHub Actions analyzes PR via API
   - Checks failing CI jobs
   - Examines changed files
   - Detects project type (Node/Python/Docker)
   - Suggests specific fixes
           │
           ▼
  Email sent with fix instructions
```

## Setup

### 1. Create Repository

Create `DerekRoberts/kilo-cloud` on GitHub and push this code.

### 2. Configure Secrets

Go to Settings → Secrets and variables → Actions, add:

| Secret | Description |
|--------|-------------|
| `EMAIL_TO` | Your email (derek.roberts@gmail.com) |
| `EMAIL_FROM` | Sender email (can be same) |
| `SMTP_HOST` | smtp.gmail.com (or your provider) |
| `SMTP_USER` | Email username |
| `SMTP_PASS` | Email app password |
| `GH_PAT` | GitHub Personal Access Token with `repo` scope |

### 3. Update Renovate Monitor

In your Renovate monitor orchestrator, update the `notifyKiloCloud` function to call this webhook:

```javascript
// Instead of sending email, trigger GitHub Actions
const webhookUrl = 'https://api.github.com/repos/DerekRoberts/kilo-cloud/dispatches';
const response = await fetch(webhookUrl, {
  method: 'POST',
  headers: {
    'Authorization': `token ${process.env.GH_PAT}`,
    'Accept': 'application/vnd.github.v3+json',
  },
  body: JSON.stringify({
    event_type: 'renovate-failed-pr',
    client_payload: {
      repo: prInfo.fullRepo,
      pr_number: prInfo.prNumber,
      pr_url: prInfo.url,
    }
  }),
});
```

### 4. Test

Trigger manually:

```bash
gh workflow run analyze-pr.yml \
  --repo DerekRoberts/kilo-cloud \
  --field repo="bcgov/quickstart-openshift-backends" \
  --field pr_number="463" \
  --field pr_url="https://github.com/bcgov/quickstart-openshift-backends/pull/463"
```

## What It Analyzes

| Project Type | Detected By | Common Fixes |
|--------------|-------------|--------------|
| **Node.js** | package.json | lint --fix, test, regenerate lockfile |
| **Python** | pyproject.toml, requirements.txt | uv lock, pytest |
| **Docker** | Dockerfile, Containerfile | base image compatibility |

## Sample Output

```
KILO CLOUD ANALYSIS REPORT
==========================

Repository: bcgov/quickstart-openshift-backends
PR: #463 - chore(deps): update dependency pytest to v9.0.3 [security]

FILES CHANGED (2):
  • backend-py/pyproject.toml (+1/-1)
  • backend-py/uv.lock (+45/-32)

FAILING CHECKS (2):
  ❌ Deploys / Stack
  ❌ PR Results

SUGGESTED FIXES:

1. [HIGH] Update uv.lock
   Command: uv lock --upgrade-package pytest
   The uv.lock file needs updating for the new dependency version

2. [HIGH] Review test failures
   Command: pytest
   Dependency update may have breaking changes
```

## Future Enhancements

- [ ] Auto-apply fixes for DerekRoberts/* repos
- [ ] Support more project types (Go, Rust, Java)
- [ ] Slack/Teams notifications
- [ ] Web dashboard of pending fixes

## License

MIT
