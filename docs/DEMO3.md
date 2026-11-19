# Demo 3 — RFI Review

The Daily To-Do is a standalone review board. Select from the bundled project records or import your own file. Demo 2 runs and Demo 4 role exchanges have separate state.

## Run a review

1. Open the [Daily To-Do](../demo3.html). Search by RFI ID or title. The bundled [RFI list](../data/realData/answerTest.json) contains 14 records with historical dates. Alternatively, choose a CSV or JSON file with 1–50 RFIs and a maximum size of 1,000,000 bytes. Each row needs an ID and a description.
2. Select the records and choose **Add selected to review**. Open **Review** to inspect the description and the available evidence before sharing anything with Jev.
3. Enable **Allow Jev to review** above the list. Choose **Classify RFIs** to process board items requiring a classification, or **Classify with Jev** inside one record. The board sends each RFI individually to the configured backend. The backend uses the ID to associate the result and sends the submitted date, needed-by date and description to Jev.
4. Choose the planning date and **RFIs per day**, then **Generate plan**. High, Mid and Low recommendations are ordered by priority, needed-by date and RFI ID. Items classified as **Lacking info** stay available for review. Reordering a task changes its position in the plan.
5. Open a task, select an outcome and enter a note, then choose **Mark reviewed**. To defer a planned task, choose **Later** and supply a future date and reason.

## Evidence and reclassification

**Description evidence** highlights matching passages on cost, schedule, work impact and safety or compliance. Counts and quotations come from text matching in the description. Review them alongside the submitted dates and Jev’s recommendation. A purchase amount, waiver threshold or reply deadline can supply context while the effect on cost or schedule remains unknown.

After a successful assessment, **Classify again** stays disabled while its three inputs match. To evaluate a revised deadline, change **Needed by** and choose **Classify again**. You can also save the new date first. Changes to the owner, review note or plan order leave the assessment inputs unchanged. A service failure can be retried with the same inputs. If you return to an already classified date with the same description and submission date, that assessment is reused.

The board saves classifications, review notes and task order in the current browser. **Export** downloads a JSON copy. **Reset demo board** clears the local board after confirmation. Undo can restore it immediately after a reset, before another change or refresh. The project records remain available in the source list.

For a local rehearsal using the hosted JEV service, run `npm run preview:live` and open [Demo 3 on port 8787](http://127.0.0.1:8787/demo3.html). The backend owns the Jev key and applies request limits. Visitors only need to authorize sending the selected fields.
