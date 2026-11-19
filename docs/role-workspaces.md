# Demo 4 · RFI exchange and priority decisions

Use the [workspace sign-in](../signin.html) in one browser. The presenter can play both participants. Keep the same RFI ID visible when switching roles so the audience can follow the question, the answer, and the receipt.

| Participant | Decisions and responsibilities |
| --- | --- |
| RFI submitter, acting as the GC coordinator | Starts the RFI, checks the evidence, confirms its review priority with a reason, routes the question, answers requests for clarification and acknowledges the issued response. |
| Responder | Receives assigned RFIs, asks for missing details, prepares the technical answer and records the external sign-off when sending it back. |

The submitter owns review priority in this demonstration. Confirm that assignment with the stakeholder when testing on their workflow. The responder owns the technical answer. Role workspaces and handoff history use browser storage on the same site. Demonstrate both sides on the same browser profile. Separate users on different devices would require shared storage and authenticated identities.

## Rehearse one round trip

1. As the submitter, start from an existing project RFI. For example, **R200-CRE-06678** asks which switchboard enclosure is acceptable. Open the source description and note the original needed-by date. The date in this project record is historical.
2. Submit the RFI for review. Run JEV with permission to send the selected inputs, or load the labeled simulated disagreement to demonstrate conflicting recommendations. Read the cited text together. For this switchboard question, procurement is mentioned and a due date is recorded. The description gives neither a dollar estimate nor the number of days a crew will be delayed.
3. Confirm the priority with a reason. Route the question to the responder. Switch to the responder and open the matching ID in the incoming work. Show who sent it and what the recipient needs to do.
4. To exercise the clarification path, ask one specific question. Switch back to the submitter and supply the additional detail. Inspect the new revision, reassess the changed inputs, confirm the priority and route the updated question. For a short rehearsal, go directly from routing to the technical response.
5. As the responder, prepare a reply and record the sign-off before sending. Use a clearly identified demonstration reference for rehearsal. As the original submitter, open the returned answer, acknowledge it and inspect the exchange history. Refresh and verify that the receipt persists.

The daily plan uses the human-confirmed priority. Moving an item changes its order for that day. Use the decision history to explain who chose the priority and which revision they reviewed.

## Evidence and calibration

The team's *Demo 3* presentation, slide 8, recorded stakeholder feedback about pre-populating cost and due-date information, problems with **Classify Again**, and using previous final evaluations for training. The earlier interview separately describes how contractors communicate needed-by dates and how higher RFI volumes affect daily review. [Earlier interview transcript](INDUSTRY-STAKEHOLDER-INTERVIEW-TRANSCRIPT.md)

For each assessment, review the source description alongside any cost and schedule evidence. A named dependency can support a priority decision while its dollar or time impact remains unknown. A due date tells the reviewer when an answer is requested. A specific delay or cost exposure needs its own evidence.

For a calibration round, record the RFI ID and revision, JEV's original label, the human-confirmed priority and reason, and the source passage that supports the correction. Review disagreements with the team before changing a prompt or rubric. Keep separate development and held-out cases. Run the same held-out set with the previous and revised prompts and report the number correct, cases missed and sample size. A daily list reorder expresses a user's preference for today's work and should be excluded from classification labels.

## Stakeholder retest

Ask a stakeholder to take one RFI from question to acknowledged answer without step-by-step coaching. Start with the RFI ID and the coordination task. Record where they pause, who they think acts next, and whether they can locate the evidence for the final priority. Then make a specific change based on an observed difficulty and repeat that step. Capture the original observation, the change, and what happened on retest.

| Check | Evidence to capture |
| --- | --- |
| Information moved between two people | The recipient locates the incoming question, and the original submitter finds the issued reply. Both can identify the other party and the next action from the record. |
| An incomplete description can still be reviewed | The tester points to a statement in the source and identifies one genuinely unknown impact, with the needed-by date shown separately. |
| A human settles a disagreement | Two recommendations for the same revision are visible with their origins. The tester explains the chosen priority and finds the recorded reason after switching roles. |
| A revision triggers a new review | The tester can distinguish the old and current assessments and confirm a decision for the updated inputs. |
| Receipt and plan order persist | Refresh after acknowledgment. Move an item in a populated daily plan and verify the stored priority and reason. |

Record these as test results only after observing a participant. A class rehearsal can verify that the controls work. A stakeholder retest supplies separate evidence about whether those controls support the contractor's workflow.
