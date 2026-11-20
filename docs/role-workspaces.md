# Role workspaces

Open `signin.html` to create an account or sign in. Account RFIs use the Node service and persist in `server-data/rfi-workspace.json` (or the path in `RFI_STORE_PATH`). Keep that path outside publicly served directories. Registration immediately signs in; an email and password identify the account, and the account's saved role and RFI history return on later sign-ins. Recipient access matches the normalized email entered on the RFI. No email confirmation or invitation codes are required. Each checker is scoped to the configured East Link · Station Systems project.

No external email notifications are sent. Email addresses are not verified, so recipient access relies on users signing in with the same address the sender entered. The backend continues to enforce each role's RFI scope. Use persistent storage for `RFI_STORE_PATH` in hosted deployments.

The existing local role demo remains available under “Open the existing local demo workspace.” It retains browser-only fictional fixture behavior and is separate from account permissions.

## Existing local role demo

Open `signin.html`, expand “Open the existing local demo workspace,” select a persona, then continue. Public project and demo pages remain accessible without signing in.

| Role | Scope | Primary actions |
|---|---|---|
| RFI submitter | Own RFIs | Create a draft, attach supporting files, submit, correct returned questions, provide clarification, read issued answers |
| Checker | Submitted project RFIs | Check completeness, return with a reason, route to the technical responder, manage a daily review plan |
| Responder | Assigned RFIs | Request clarification, save technical drafts, prepare for sign-off, record external reviewer/reference and issue an answer |
| Schedule manager | Company-created or company-responsible RFIs | Revise company-created questions; set dates only for company-responsible open records |
| Reader | Submitted project RFIs | Search, filter, inspect official responses and history; no mutation actions |

## Workflow

Draft → submitted → checker approval/routing → assigned responder → sign-off pending → issued answer.
Return and clarification paths send work back to the originator. Manager revisions preserve the previous version and response, invalidate the old recommendation, and return the RFI to the checker. Technical sign-off is recorded as an external attestation; there is no independent approval service.

PDF/PNG/JPEG files are stored locally (maximum three files per RFI, 1 MB per file), with downloadable originals. Dates require change reasons. Edits include activity history and stale-record checks. Daily plans retain manual ordering for the current day.

## Current boundary

The account workflow uses server-side sessions and record-level checks. The local role demo still uses browser role selection/localStorage and is not production identity/access control. Sample recommendations are not new live agent results. The existing public Demo 2 and Demo 3 are unchanged.

The local JSON store is intended for a single Node service instance; do not run multiple writers against the same file. Preserve the existing scoped actions and revision invalidation in the local role demo.

## Validation

99 automated tests pass, including role visibility/action boundaries, revision invalidation and attachment limits. Static asset/link validation passes. Browser walkthrough verified response preparation, sign-off, publication and manager revision returning to the checker queue.
