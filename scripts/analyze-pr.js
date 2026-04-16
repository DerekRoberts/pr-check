#!/usr/bin/env node
/**
 * Kilo Cloud - PR Analyzer
 * 
 * Analyzes failing Renovate/Dependabot PRs and suggests fixes
 * WITHOUT forking or cloning - uses GitHub API only
 */

const { Octokit } = require('@octokit/rest');
const nodemailer = require('nodemailer');

// Parse inputs from environment or event payload
const eventPayload = process.env.GITHUB_EVENT_PATH 
  ? require(process.env.GITHUB_EVENT_PATH)
  : {};

const inputs = {
  repo: process.env.REPO || eventPayload.client_payload?.repo || eventPayload.inputs?.repo,
  prNumber: parseInt(process.env.PR_NUMBER || eventPayload.client_payload?.pr_number || eventPayload.inputs?.pr_number),
  prUrl: process.env.PR_URL || eventPayload.client_payload?.pr_url || eventPayload.inputs?.pr_url,
};

if (!inputs.repo || !inputs.prNumber) {
  console.error('Missing required inputs: repo and pr_number');
  process.exit(1);
}

const [owner, repo] = inputs.repo.split('/');

// Initialize Octokit
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

async function analyzePR() {
  console.log(`🔍 Analyzing ${inputs.repo}#${inputs.prNumber}`);
  
  try {
    // 1. Get PR details
    const { data: pr } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: inputs.prNumber,
    });
    
    console.log(`📋 PR: ${pr.title}`);
    console.log(`🌿 Branch: ${pr.head.ref}`);
    
    // 2. Get failing checks
    const { data: checks } = await octokit.rest.checks.listForRef({
      owner,
      repo,
      ref: pr.head.sha,
    });
    
    const failingChecks = checks.check_runs.filter(
      check => check.conclusion === 'failure' || check.conclusion === 'cancelled'
    );
    
    console.log(`❌ Failing checks: ${failingChecks.length}`);
    
    // 3. Get PR files (what changed)
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: inputs.prNumber,
    });
    
    console.log(`📁 Files changed: ${files.length}`);
    
    // 4. Analyze based on file types and failures
    const analysis = await performAnalysis(files, failingChecks, pr);
    
    // 5. Generate report
    const report = generateReport(inputs.repo, inputs.prNumber, pr, failingChecks, files, analysis);
    
    console.log('\n📊 Analysis Complete');
    console.log(report);
    
    // 6. Post comment on PR
    await postComment(report, inputs.repo, inputs.prNumber);
    
  } catch (error) {
    console.error('❌ Analysis failed:', error.message);
    process.exit(1);
  }
}

async function performAnalysis(files, failingChecks, pr) {
  const analysis = {
    type: 'unknown',
    confidence: 'low',
    suggestions: [],
    notes: [],
  };
  
  // Detect update type from files
  const hasPackageJson = files.some(f => f.filename.includes('package.json'));
  const hasPackageLock = files.some(f => f.filename.includes('package-lock.json'));
  const hasPyproject = files.some(f => f.filename.includes('pyproject.toml'));
  const hasUvLock = files.some(f => f.filename.includes('uv.lock'));
  const hasRequirements = files.some(f => f.filename.includes('requirements.txt'));
  const hasDockerfile = files.some(f => f.filename.includes('Dockerfile') || f.filename.includes('Containerfile'));
  const hasCompose = files.some(f => f.filename.includes('compose.yml') || f.filename.includes('docker-compose'));
  
  // Analyze failing check names for clues
  const checkNames = failingChecks.map(c => c.name.toLowerCase());
  const hasLintFailure = checkNames.some(n => n.includes('lint') || n.includes('format'));
  const hasTestFailure = checkNames.some(n => n.includes('test') || n.includes('spec'));
  const hasBuildFailure = checkNames.some(n => n.includes('build') || n.includes('compile'));
  const hasSecurityFailure = checkNames.some(n => n.includes('security') || n.includes('trivy') || n.includes('scan'));
  
  // TypeScript/JavaScript projects
  if (hasPackageJson) {
    analysis.type = 'node';
    analysis.confidence = 'medium';
    
    if (hasLintFailure) {
      analysis.suggestions.push({
        priority: 'high',
        action: 'Run linter with autofix',
        command: 'npm run lint -- --fix',
        description: 'Dependency update may have introduced linting violations',
      });
    }
    
    if (hasTestFailure) {
      analysis.suggestions.push({
        priority: 'high',
        action: 'Review test failures',
        command: 'npm test',
        description: 'Dependency update may have breaking changes affecting tests',
      });
    }
    
    if (hasBuildFailure && hasPackageLock) {
      analysis.suggestions.push({
        priority: 'medium',
        action: 'Regenerate package-lock.json',
        command: 'rm package-lock.json && npm install',
        description: 'Lockfile may be out of sync with updated dependencies',
      });
    }
  }
  
  // Python projects
  if (hasPyproject || hasRequirements) {
    analysis.type = 'python';
    analysis.confidence = 'medium';
    
    if (hasUvLock) {
      analysis.suggestions.push({
        priority: 'high',
        action: 'Update uv.lock',
        command: 'uv lock --upgrade-package <package-name>',
        description: 'The uv.lock file needs updating for the new dependency version',
      });
    }
    
    if (hasTestFailure) {
      analysis.suggestions.push({
        priority: 'high',
        action: 'Review test failures',
        command: 'pytest',
        description: 'Dependency update may have breaking changes',
      });
    }
  }
  
  // Docker projects
  if (hasDockerfile) {
    analysis.suggestions.push({
      priority: 'medium',
      action: 'Verify base image compatibility',
      description: 'Docker base image update may require Dockerfile adjustments',
    });
  }
  
  // Generic suggestions for any failure
  if (failingChecks.length > 0) {
    analysis.suggestions.push({
      priority: 'low',
      action: 'Review CI logs',
      command: `gh run view --repo ${inputs.repo} --failed`,
      description: 'Check the detailed CI logs for specific error messages',
    });
  }
  
  // Check for Renovate-specific patterns
  if (pr.title.includes('security') || pr.title.includes('vulnerability')) {
    analysis.notes.push('⚠️ This is a SECURITY update. Prioritize fixing over closing.');
  }
  
  if (pr.title.includes('major')) {
    analysis.notes.push('⚠️ MAJOR version update. Likely has breaking changes requiring code updates.');
  }
  
  return analysis;
}

function generateReport(repo, prNumber, pr, failingChecks, files, analysis) {
  let report = `PR-CHECK ANALYSIS REPORT
========================

Repository: ${repo}
PR: #${prNumber} - ${pr.title}
URL: ${pr.html_url}
Branch: ${pr.head.ref}
Author: ${pr.user.login}
Created: ${pr.created_at}

`;

  report += `FILES CHANGED (${files.length}):
`;
  files.forEach(f => {
    report += `  • ${f.filename} (+${f.additions}/-${f.deletions})\n`;
  });
  report += '\n';

  report += `FAILING CHECKS (${failingChecks.length}):
`;
  failingChecks.forEach(check => {
    report += `  ❌ ${check.name}\n`;
    report += `     Status: ${check.conclusion}\n`;
    if (check.output?.summary) {
      report += `     Summary: ${check.output.summary.substring(0, 200)}...\n`;
    }
    report += `     Details: ${check.html_url}\n\n`;
  });

  if (analysis.notes.length > 0) {
    report += `IMPORTANT NOTES:
`;
    analysis.notes.forEach(note => {
      report += `  ${note}\n`;
    });
    report += '\n';
  }

  report += `SUGGESTED FIXES (${analysis.suggestions.length}):
`;
  analysis.suggestions.forEach((suggestion, idx) => {
    report += `\n${idx + 1}. [${suggestion.priority.toUpperCase()}] ${suggestion.action}\n`;
    if (suggestion.command) {
      report += `   Command: ${suggestion.command}\n`;
    }
    report += `   ${suggestion.description}\n`;
  });

  report += `
NEXT STEPS:
1. Review the suggested fixes above
2. Check the detailed CI logs: ${failingChecks[0]?.html_url || pr.html_url}
3. Apply fixes locally or push changes to the PR branch
4. Re-run CI to verify

---
Analysis Confidence: ${analysis.confidence.toUpperCase()}
Project Type: ${analysis.type.toUpperCase()}
Generated: ${new Date().toISOString()}
`;

  return report;
}

// MVP: Allowed repos list
const ALLOWED_REPOS = [
  'bcgov/quickstart-openshift-backends',
  'bcgov/nr-fom',
  'DerekRoberts/vexilon',
  // Add more as needed
];

async function postComment(report, repo, prNumber) {
  // Check if repo is in allowlist during MVP
  if (!ALLOWED_REPOS.includes(repo)) {
    console.log(`⚠️ Repo ${repo} not in MVP allowlist. Skipping.`);
    console.log('Allowed repos:', ALLOWED_REPOS.join(', '));
    console.log('\nReport that would have been posted:');
    console.log(report);
    return;
  }
  
  try {
    await octokit.rest.issues.createComment({
      owner: repo.split('/')[0],
      repo: repo.split('/')[1],
      issue_number: prNumber,
      body: `## 🤖 pr-check Analysis\n\n${report}\n\n---\n*This is an automated analysis. Please review and apply fixes as needed.*`,
    });
    console.log(`💬 Comment posted to ${repo}#${prNumber}`);
  } catch (error) {
    console.error('❌ Failed to post comment:', error.message);
    console.log('\nReport:');
    console.log(report);
  }
}

// Run analysis
analyzePR();
