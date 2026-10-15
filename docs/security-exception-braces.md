# Approved temporary security exception: GHSA-vfj7-8cjw-p6xm

Status: 1 HIGH — ACCEPTED TEMPORARY EXCEPTION. Not an audit PASS.
Approved explicitly by the user on 2026-10-14, only for development tooling. Commit/push authorized only after final review and verification, to origin/redesign/integration-remediation.
Checked: 2026-10-14. Expiry: 2026-11-13, or any invalidation condition below, whichever occurs first.
Approval owner: FLOZ repository/security owner. Execution owner: FLOZ maintainer.

## Upstream status

- GitHub reviewed advisory: HIGH, CVSS 7.5, affected <=3.0.3, first_patched_version=null, not withdrawn.
- Direct registry query: braces latest=3.0.3; no patched published version.
- Latest micromatch 4.0.8 depends on braces ^3.0.3. Latest fast-glob 3.3.3 depends on micromatch ^4.0.8.
- Latest @next/eslint-plugin-next 16.4.0 still pins fast-glob 3.3.1. Upgrading these parents does not remove this advisory.
- Upstream issue #70 is open. Maintainer disputes the advisory; no official depth-guard release identified. That dispute is not grounds for declaring PASS.
- No new override, replacement package, downgrade, rule removal or framework migration applied.

Sources:
https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
https://api.github.com/advisories/GHSA-vfj7-8cjw-p6xm
https://registry.npmjs.org/braces
https://registry.npmjs.org/micromatch/latest
https://registry.npmjs.org/fast-glob/latest
https://registry.npmjs.org/@next%2feslint-plugin-next/latest
https://github.com/micromatch/braces/issues/70

## Reachability and trust boundary

- pnpm -r why braces identifies only devDependencies: root/web @next/eslint-plugin-next 16.3.2 and web eslint-config-next 15.5.27 -> @next/eslint-plugin-next 15.5.27 -> fast-glob 3.3.1 -> micromatch 4.0.8 -> patched braces 3.0.3.
- pnpm -r why braces --prod returns no paths. pnpm audit --prod exits 0, all vulnerability counts zero.
- Source search found no application imports of braces, micromatch, fast-glob or the Next lint plugin. Existing web build has 28 .nft.json traces, no references to this dependency chain.
- Docker web/api/worker builds use frozen install, then pnpm deploy --prod; only /out is copied to runtime. Actual isolated web dependency packaging with deploy --prod contains none of braces/micromatch/fast-glob/@next/eslint-plugin-next. This was local packaging, not a deployment.
- Next lint plugin get-root-dirs supplies fast-glob with context.cwd or settings.next.rootDir. FLOZ eslint.config.cjs:33 sets rootDir to the repository's apps/web directory. No HTTP body/query, uploaded file content or database field reaches that pattern input in current source.
- Untrusted pull requests can change lint configuration, manifests or source executed in CI. This is a build/CI trust boundary, not a production HTTP path. The local depth guard limits this specific recursion issue; it does not make running arbitrary untrusted repository code safe.
- Production exclusion is established for the inspected source, graph, existing traces and packaging. No new Linux container build or deployed runtime was exercised.

## Local mitigation and proof

- Existing patch bounded parser braces/parentheses, compile/expand/stringify recursion and expand parent-chain traversal at 256.
- Additional verification reproduced an uncovered stack overflow through deeply nested caller-supplied AST array values in expand/flatten. Patch now also bounds recursive append (both queue/stash branches) and utils.flatten. No application code changed.
- Regression suite: 20/20 PASS in worktree; 20/20 PASS after isolated frozen clean install. Added mixed/dollar/unclosed patterns, cyclic AST/array and nested array tests; previous deep AST, parent-cycle and normal-glob cases retained.
- Node 22.23.2 directly ran worktree suite: 20/20 PASS. Node 26.7.0 ran isolated suite: 20/20 PASS. Independent assert harness on clean copy under Node 22: 69/69 checks PASS; prior array-value overflow now produces the controlled depth-limit RangeError.
- Narrow ESLint check and @floz/infra typecheck: PASS. git diff --check: PASS. Full monorepo QA not repeated.
- Fresh isolated store was populated by downloading the frozen tree; second empty-node_modules copy reused only that isolated store. Frozen install exits 0; lockfile SHA256 unchanged: ebf57607bd8bac48780ab648146d5e2042b3bf5cf536dad08f853d00553e1de2.
- pnpm patch hash: qnw5jesjhm5aiuhi6e2ehow2n4. Lock update changed only three hash references relative to pre-task lockfile. Installed parse/compile/expand/stringify/utils SHA256 match between worktree and clean copy.
- Existing local pnpm store initially yielded unpatched files despite the new patch-hash directory. Reinstall from the isolated verified store restored all guards; final 20-test worktree run PASS. Therefore install exit code or directory hash alone is insufficient; CI must execute the regression suite.
- Isolated Windows deploy packaging emitted development-bin ENOENT and an existing vite peer warning; dependency exclusion passed, not a blanket packaging PASS.
- Direct Node 22 Vitest launch in the long-path isolated copy hit ERR_PACKAGE_IMPORT_NOT_DEFINED (#module-evaluator); direct worktree Node 22 launch and clean-copy standalone Node 22 checks passed. This limitation is not a claimed clean-copy Node 22 Vitest PASS.

Latest unsuppressed audit: full exits 1 with exactly one HIGH (this GHSA); production exits 0; muted=[]. Local patch does not change the upstream version-based audit classification.

## Finalization verification

- Existing final source QA remains valid: 1,023 monorepo tests PASS; 32 Playwright cases PASS, zero skipped/unexpected/flaky; lint, typecheck and build exit 0. Evidence: local scratch floz-closure-20261014/final-v3/exits.json, tests.log and e2e.log. No full rerun after approval; application source is unchanged since that run.
- After approval: Node 22 targeted braces regression 20/20 PASS; standalone vulnerable-path checks 69/69 PASS; workflow-related production-images tests 8/8 PASS. Workflow YAML parsing/assertions PASS for all three workflows (read-only permissions, no secret references/pull_request_target, hosted runners, no persisted checkout credentials).
- Final infra verification: pnpm run test (63/63), pnpm run lint and pnpm run typecheck exit 0. Existing DEP0137 file-descriptor garbage-collection warnings remain visible; no test failures.
- Rechecked unsuppressed full audit: one HIGH, GHSA-vfj7-8cjw-p6xm only; production audit: zero. Worktree and isolated frozen-install copy retain identical lockfile SHA256 and all five patched module hashes. pnpm -r why braces --prod still returns no paths.
- git diff --check and git fsck --connectivity-only --no-dangling exit 0. Static added-line scan found no secret literals or eval/shell execution additions; this is a bounded scan, not a general security certification.

## Residual risk and exception limits

- Accepted residual risk: low production exposure for this advisory under current packaging; bounded but nonzero developer/CI availability and maintenance risk. Upstream severity remains HIGH.
- Guards deliberately throw RangeError. Uncaught rejection can still fail a lint/build job. Arbitrary malformed ASTs, getters/proxies, combinatorial expansion, regex complexity and other resource exhaustion are not generally solved by nesting limits.
- A locally maintained patch can diverge from upstream, reject unusually deep legitimate globs or be omitted by a changed install mechanism. Regression tests and frozen lockfile are mandatory; max depth must not be increased within this exception.
- Applies only to braces@3.0.3 with patch hash qnw5jesjhm5aiuhi6e2ehow2n4, current dev-only chains and current production packaging. No audit suppression, production promotion, untrusted user glob API or broader security acceptance.
- Invalid immediately if braces enters runtime imports/production graph, user-controlled patterns become reachable, patch/hash/install behavior changes, regression fails, exploitation evidence appears, or another advisory is found.
- CI uses pull_request, not pull_request_target; GitHub-hosted runners, explicit contents: read, no secret references, no write/id-token permissions, no deployment job. Checkout does not persist credentials. Both checkout workflows disable persisted credentials; all workflows have explicit read-only permissions. Untrusted PR code still executes inside the disposable runner; no claim of general code sandboxing. Organization-level policies and external integrations are outside this repository-only review.

## Upstream replacement plan

- Maintainer checks npm release/advisory/issue weekly and before release, manually unless separate automation is approved.
- Within two working days of an official compatible fix: update only the needed lock resolution/direct parent, remove local patch, run recursion regression, frozen clean install and unsuppressed full/production audit. Run only additional gates relevant to changed dependencies.
- Close exception only when patched official dependency resolves and security policy gates pass. If no fix by 2026-11-13, stop for explicit renewal or a separately approved dependency-removal/tooling migration; no automatic extension.

## Approved decision

The user approved this time-bounded exception through 2026-11-13 and authorized structured commits and a normal push only to origin/redesign/integration-remediation after final gates. Approval accepts the still-visible HIGH dev advisory under the stated controls; it is not a technical audit PASS. Any new blocker or unverified change stops finalization. No merge, deploy or force push.
