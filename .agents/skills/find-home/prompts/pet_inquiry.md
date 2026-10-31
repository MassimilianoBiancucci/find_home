# Draft a pet inquiry

For listings with `pet_status` ask or unknown. **Drafts only: never send.**

1. `scripts/findhome digest listing <id> --fields full` for the facts (address, contract, dates).
2. Draft a short, polite message in Swedish, with an English copy below it:
   - who: the user (first name only, ask if unknown), working in Stockholm, looking from <available_from>;
   - the cats: two indoor cats. Placeholders the user must confirm: `[neutered/spayed]`, `[vaccinated]`,
     `[insured]`, `[age]`. Do not invent facts;
   - offer: references from earlier landlords, extra deposit if needed, happy to show the cats' records;
   - the question, clearly: "Går det bra med två innekatter?" ("Are two indoor cats OK?").
3. Store it as an evaluation for that listing: `questions_for_landlord: ["Two indoor cats OK?"]`,
   and put the full draft in `extracted.pet_inquiry_draft_sv` / `extracted.pet_inquiry_draft_en`.
   Ingest with `scripts/findhome ingest evaluations -f <file>`.
4. Mention the draft in the scratchpad Handover so the user can send it.
