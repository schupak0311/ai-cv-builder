# AI CV Builder

A signed-in user turns their own material into a CV for one target role, reviews and edits it, and downloads it as an A4 PDF. The AI may rephrase and restructure, but every fact in a CV must come from the user.

## Language

**Source**:
The material a user provides for one CV: the text extracted from an uploaded PDF, or a free-text description of their background.
_Avoid_: input, upload, original CV, resume

**CV**:
The document the app produces from one Source for one Target role, which the user reviews, edits and downloads.
_Avoid_: draft, resume, result

**Target role**:
The job title a CV is written for, such as "Senior Backend Engineer".
_Avoid_: position, job, title

**Claim**:
One statement of fact in a CV, such as a bullet, a summary sentence, or an employer with its dates.
_Avoid_: fact, item, line

**Evidence**:
The exact passage of the Source that a Claim is based on.
_Avoid_: citation, reference, proof

**Question**:
A request to the user for a fact that is missing or vague in the Source, about one section of a CV.
_Avoid_: prompt, gap, clarification

**Answer**:
The user's reply to a Question, which becomes one of the CV's facts.
_Avoid_: response, reply

## Relationships

- A **User** owns zero or more **CVs**.
- A **CV** has exactly one **Source** and exactly one **Target role**.
- A **Source** belongs to exactly one **CV** and is never shared between CVs.
- **Sources** and **CVs** are in English. Other languages are out of scope.
- Every AI-written **Claim** has **Evidence** in its CV's **Source**. A **Claim** without matching **Evidence** is dropped from the **CV** without notice.
- A **CV** has zero or more **Questions**. An **Answer** updates only the section its **Question** is about, and counts only once that section is revised. Until then the **Question** stays open.

## Example dialogue

> **Dev:** "Anna wants a second **CV** for Engineering Manager. Does it reuse her first **Source**?"
> **Domain expert:** "No. She starts a new **CV** with its own **Source**. Her answers to the first CV's questions stay with the first **CV**."

## Flagged ambiguities

- "CV" was used for both the uploaded PDF and the generated document. Resolved: the uploaded material is the **Source**, the generated document is the **CV**.
