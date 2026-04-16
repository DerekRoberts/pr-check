# 🔍 pr-check

Automated analysis of failing Renovate/Dependabot PRs. Receives webhooks, analyzes failures via GitHub API, and posts analysis as PR comments.

## How It Works

```
Renovate Monitor detects failing PR
           │
           ▼
  POST to pr-check webhook
           │
           ▼
GitHub Actions analyzes PR via API
   - Checks failing CI jobs
   - Examines changed files
   - Detects project type (Node/Python/Docker)
   - Suggests specific fixes
           │
           ▼
  Comment posted on original PR
```

## MVP Status

**Current scope:** Limited to allowlisted repos during testing.

**Allowed repos:**
- `bcgov/quickstart-openshift-backends`
- `bcgov/nr-fom`
- `DerekRoberts/vexilon`

Add more to `ALLOWED_REPOS` in `scripts/analyze-pr.js` when ready.

## Setup

### 1. Create Repository

```bash
gh repo create DerekRoberts/pr-check --public
cd /path/to/pr-check
git remote add origin https://github.com/DerekRoberts/pr-check.git
git branch -M main
git push -u origin main
```

### 2. Configure Secrets

Go to Settings → Secrets and variables → Actions, add:

| Secret | Description |
|--------|-------------|
| `GH_PAT` | GitHub Personal Access Token with `repo` and `pull_requests:write` scope |

### 3. Update Renovate Monitor

In your Renovate monitor orchestrator, update to call this webhook:

```javascript
const webhookUrl = 'https://api.github.com/repos/DerekRoberts/pr-check/dispatches';
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
  --repo DerekRoberts/pr-check \
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

Posted as a PR comment:

```markdown
## 🤖 pr-check Analysis

PR-CHECK ANALYSIS REPORT
========================

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

---
*This is an automated analysis. Please review and apply fixes as needed.*
```

## Future Enhancements

- [ ] Remove allowlist after MVP testing
- [ ] Auto-apply fixes for DerekRoberts/* repos
- [ ] Support more project types (Go, Rust, Java)
- [ ] Parse actual error logs for smarter suggestions
- [ ] Read changelogs to highlight breaking changes

## License

MIT
